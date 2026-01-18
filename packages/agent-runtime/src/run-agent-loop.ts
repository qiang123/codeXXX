/**
 * Agent execution loop - orchestrates multiple agent steps
 */

import { buildArray } from '@codebuff/common/util/array'
import { getErrorObject } from '@codebuff/common/util/error'
import { userMessage } from '@codebuff/common/util/messages'
import { cloneDeep, mapValues } from 'lodash'
import { APICallError, type ToolSet } from 'ai'

import { callTokenCountAPI } from './llm-api/codebuff-web-api'
import { getMCPToolData } from './mcp'
import { runProgrammaticStep } from './run-programmatic-step'
import { additionalSystemPrompts } from './system-prompt/prompts'
import { getAgentTemplate } from './templates/agent-registry'
import { buildAgentToolSet } from './templates/prompts'
import { getAgentPrompt } from './templates/strings'
import { getToolSet } from './tools/prompts'
import { getAgentOutput } from './util/agent-output'
import {
  withSystemInstructionTags,
  withSystemTags,
  buildUserMessageContent,
  expireMessages,
} from './util/messages'
import { countTokensJson } from './util/token-counter'
import { runAgentStep } from './run-agent-step'

import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type {
  AddAgentStepFn,
  FinishAgentRunFn,
  StartAgentRunFn,
} from '@codebuff/common/types/contracts/database'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { ParamsExcluding } from '@codebuff/common/types/function-params'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type {
  TextPart,
  ImagePart,
} from '@codebuff/common/types/messages/content-part'
import type {
  AgentTemplateType,
  AgentState,
  AgentOutput,
} from '@codebuff/common/types/session-state'
import type { CustomToolDefinitions, ProjectFileContext } from '@codebuff/common/util/file'

/**
 * Build additional tool definitions from MCP servers and custom tools
 */
async function additionalToolDefinitions(
  params: {
    agentTemplate: AgentTemplate
    fileContext: ProjectFileContext
  } & ParamsExcluding<
    typeof getMCPToolData,
    'toolNames' | 'mcpServers' | 'writeTo'
  >,
): Promise<CustomToolDefinitions> {
  const { agentTemplate, fileContext } = params

  const defs = cloneDeep(
    Object.fromEntries(
      Object.entries(fileContext.customToolDefinitions).filter(([toolName]) =>
        agentTemplate!.toolNames.includes(toolName),
      ),
    ),
  )
  return getMCPToolData({
    ...params,
    toolNames: agentTemplate!.toolNames,
    mcpServers: agentTemplate!.mcpServers,
    writeTo: defs,
  })
}

/**
 * Main agent execution loop - runs multiple steps until completion
 */
export async function loopAgentSteps(
  params: {
    addAgentStep: AddAgentStepFn
    agentState: AgentState
    agentType: AgentTemplateType
    clearUserPromptMessagesAfterResponse?: boolean
    clientSessionId: string
    content?: Array<TextPart | ImagePart>
    fileContext: ProjectFileContext
    finishAgentRun: FinishAgentRunFn
    localAgentTemplates: Record<string, AgentTemplate>
    logger: Logger
    parentSystemPrompt?: string
    parentTools?: ToolSet
    prompt: string | undefined
    signal: AbortSignal
    spawnParams: Record<string, any> | undefined
    startAgentRun: StartAgentRunFn
    userId: string | undefined
    userInputId: string
    agentTemplate?: AgentTemplate
  } & ParamsExcluding<typeof additionalToolDefinitions, 'agentTemplate'> &
    ParamsExcluding<
      typeof runProgrammaticStep,
      | 'agentState'
      | 'onCostCalculated'
      | 'prompt'
      | 'runId'
      | 'stepNumber'
      | 'stepsComplete'
      | 'system'
      | 'template'
      | 'toolCallParams'
      | 'tools'
    > &
    ParamsExcluding<typeof getAgentTemplate, 'agentId'> &
    ParamsExcluding<
      typeof getAgentPrompt,
      | 'agentTemplate'
      | 'promptType'
      | 'agentTemplates'
      | 'additionalToolDefinitions'
    > &
    ParamsExcluding<
      typeof getMCPToolData,
      'toolNames' | 'mcpServers' | 'writeTo'
    > &
    ParamsExcluding<StartAgentRunFn, 'agentId' | 'ancestorRunIds'> &
    ParamsExcluding<
      FinishAgentRunFn,
      'runId' | 'status' | 'totalSteps' | 'directCredits' | 'totalCredits'
    > &
    ParamsExcluding<
      typeof runAgentStep,
      | 'additionalToolDefinitions'
      | 'agentState'
      | 'agentTemplate'
      | 'prompt'
      | 'runId'
      | 'spawnParams'
      | 'system'
      | 'tools'
    > &
    ParamsExcluding<
      AddAgentStepFn,
      | 'agentRunId'
      | 'stepNumber'
      | 'credits'
      | 'childRunIds'
      | 'messageId'
      | 'status'
      | 'startTime'
    >,
): Promise<{
  agentState: AgentState
  output: AgentOutput
}> {
  const {
    addAgentStep,
    agentState: initialAgentState,
    agentType,
    clearUserPromptMessagesAfterResponse = true,
    clientSessionId,
    content,
    fileContext,
    finishAgentRun,
    localAgentTemplates,
    logger,
    parentSystemPrompt,
    parentTools,
    prompt,
    signal,
    spawnParams,
    startAgentRun,
    userId,
    userInputId,
    clientEnv,
    ciEnv,
  } = params

  let agentTemplate = params.agentTemplate
  if (!agentTemplate) {
    agentTemplate =
      (await getAgentTemplate({
        ...params,
        agentId: agentType,
      })) ?? undefined
  }
  if (!agentTemplate) {
    throw new Error(`Agent template not found for type: ${agentType}`)
  }

  if (signal.aborted) {
    return {
      agentState: initialAgentState,
      output: {
        type: 'error',
        message: 'Run cancelled by user',
      },
    }
  }

  const runId = await startAgentRun({
    ...params,
    agentId: agentTemplate.id,
    ancestorRunIds: initialAgentState.ancestorRunIds,
  })
  if (!runId) {
    throw new Error('Failed to start agent run')
  }
  initialAgentState.runId = runId

  let cachedAdditionalToolDefinitions: CustomToolDefinitions | undefined
  // Use parent's tools for prompt caching when inheritParentSystemPrompt is true
  const useParentTools =
    agentTemplate.inheritParentSystemPrompt && parentTools !== undefined

  // Initialize message history with user prompt and instructions on first iteration
  const instructionsPrompt = await getAgentPrompt({
    ...params,
    agentTemplate,
    promptType: { type: 'instructionsPrompt' },
    agentTemplates: localAgentTemplates,
    useParentTools,
    additionalToolDefinitions: async () => {
      if (!cachedAdditionalToolDefinitions) {
        cachedAdditionalToolDefinitions = await additionalToolDefinitions({
          ...params,
          agentTemplate,
        })
      }
      return cachedAdditionalToolDefinitions
    },
  })

  // Build the initial message history with user prompt and instructions
  // Generate system prompt once, using parent's if inheritParentSystemPrompt is true
  let system: string
  if (agentTemplate.inheritParentSystemPrompt && parentSystemPrompt) {
    system = parentSystemPrompt
  } else {
    const systemPrompt = await getAgentPrompt({
      ...params,
      agentTemplate,
      promptType: { type: 'systemPrompt' },
      agentTemplates: localAgentTemplates,
      additionalToolDefinitions: async () => {
        if (!cachedAdditionalToolDefinitions) {
          cachedAdditionalToolDefinitions = await additionalToolDefinitions({
            ...params,
            agentTemplate,
          })
        }
        return cachedAdditionalToolDefinitions
      },
    })
    system = systemPrompt ?? ''
  }

  // Build agent tools (agents as direct tool calls) for non-inherited tools
  const agentTools = useParentTools
    ? {}
    : await buildAgentToolSet({
        ...params,
        spawnableAgents: agentTemplate.spawnableAgents,
        agentTemplates: localAgentTemplates,
      })

  const tools = useParentTools
    ? parentTools
    : await getToolSet({
        toolNames: agentTemplate.toolNames,
        additionalToolDefinitions: async () => {
          if (!cachedAdditionalToolDefinitions) {
            cachedAdditionalToolDefinitions = await additionalToolDefinitions({
              ...params,
              agentTemplate,
            })
          }
          return cachedAdditionalToolDefinitions
        },
        agentTools,
      })

  const hasUserMessage = Boolean(
    prompt ||
    (spawnParams && Object.keys(spawnParams).length > 0) ||
    (content && content.length > 0),
  )

  const initialMessages = buildArray<Message>(
    ...initialAgentState.messageHistory,

    hasUserMessage && [
      {
        role: 'user' as const,
        content: buildUserMessageContent(prompt, spawnParams, content),
        tags: ['USER_PROMPT'],
        sentAt: Date.now(),
        keepDuringTruncation: true,
      },
      prompt &&
        prompt in additionalSystemPrompts &&
        userMessage(
          withSystemInstructionTags(
            additionalSystemPrompts[
              prompt as keyof typeof additionalSystemPrompts
            ],
          ),
        ),
      ,
    ],

    instructionsPrompt &&
      userMessage({
        content: instructionsPrompt,
        tags: ['INSTRUCTIONS_PROMPT'],
        keepLastTags: ['INSTRUCTIONS_PROMPT'],
      }),
  )

  // Convert tools to a serializable format for context-pruner token counting
  const toolDefinitions = mapValues(tools, (tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema as {},
  }))

  const additionalToolDefinitionsWithCache = async () => {
    if (!cachedAdditionalToolDefinitions) {
      cachedAdditionalToolDefinitions = await additionalToolDefinitions({
        ...params,
        agentTemplate,
      })
    }
    return cachedAdditionalToolDefinitions
  }

  let currentAgentState: AgentState = {
    ...initialAgentState,
    messageHistory: initialMessages,
    systemPrompt: system,
    toolDefinitions,
  }
  let shouldEndTurn = false
  let hasRetriedOutputSchema = false
  let currentPrompt = prompt
  let currentParams = spawnParams
  let totalSteps = 0
  let nResponses: string[] | undefined = undefined

  try {
    while (true) {
      totalSteps++
      if (signal.aborted) {
        logger.info(
          {
            userId,
            userInputId,
            clientSessionId,
            totalSteps,
            runId,
          },
          'Agent run cancelled by user',
        )
        break
      }

      const startTime = new Date()

      const stepPrompt = await getAgentPrompt({
        ...params,
        agentTemplate,
        promptType: { type: 'stepPrompt' },
        fileContext,
        agentState: currentAgentState,
        agentTemplates: localAgentTemplates,
        logger,
        additionalToolDefinitions: additionalToolDefinitionsWithCache,
      })
      const messagesWithStepPrompt = buildArray(
        ...currentAgentState.messageHistory,
        stepPrompt &&
          userMessage({
            content: stepPrompt,
          }),
      )

      // Check context token count via Anthropic API
      const tokenCountResult = await callTokenCountAPI({
        messages: messagesWithStepPrompt,
        system,
        fetch,
        logger,
        env: { clientEnv, ciEnv },
      })
      if (tokenCountResult.inputTokens !== undefined) {
        currentAgentState.contextTokenCount = tokenCountResult.inputTokens
      } else if (tokenCountResult.error) {
        logger.warn(
          { error: tokenCountResult.error },
          'Failed to get token count from Anthropic API',
        )
        // Fall back to local estimate
        const estimatedTokens =
          countTokensJson(currentAgentState.messageHistory) +
          countTokensJson(system) +
          countTokensJson(toolDefinitions)
        currentAgentState.contextTokenCount = estimatedTokens
      }

      // 1. Run programmatic step first if it exists
      let n: number | undefined = undefined

      if (agentTemplate.handleSteps) {
        const programmaticResult = await runProgrammaticStep({
          ...params,

          agentState: currentAgentState,
          localAgentTemplates,
          nResponses,
          onCostCalculated: async (credits: number) => {
            currentAgentState.creditsUsed += credits
            currentAgentState.directCreditsUsed += credits
          },
          prompt: currentPrompt,
          runId,
          stepNumber: totalSteps,
          stepsComplete: shouldEndTurn,
          system,
          tools,
          template: agentTemplate,
          toolCallParams: currentParams,
        })
        const {
          agentState: programmaticAgentState,
          endTurn,
          stepNumber,
          generateN,
        } = programmaticResult
        n = generateN

        currentAgentState = programmaticAgentState
        totalSteps = stepNumber

        shouldEndTurn = endTurn
      }

      // Check if output is required but missing
      if (
        agentTemplate.outputSchema &&
        currentAgentState.output === undefined &&
        shouldEndTurn &&
        !hasRetriedOutputSchema
      ) {
        hasRetriedOutputSchema = true
        logger.warn(
          {
            agentType,
            agentId: currentAgentState.agentId,
            runId,
          },
          'Agent finished without setting required output, restarting loop',
        )

        // Add system message instructing to use set_output
        const outputSchemaMessage = withSystemTags(
          `You must use the "set_output" tool to provide a result that matches the output schema before ending your turn. The output schema is required for this agent.`,
        )

        currentAgentState.messageHistory = [
          ...currentAgentState.messageHistory,
          userMessage({
            content: outputSchemaMessage,
            keepDuringTruncation: true,
          }),
        ]

        // Reset shouldEndTurn to continue the loop
        shouldEndTurn = false
      }

      // End turn if programmatic step ended turn, or if the previous runAgentStep ended turn
      if (shouldEndTurn) {
        break
      }

      const creditsBefore = currentAgentState.directCreditsUsed
      const childrenBefore = currentAgentState.childRunIds.length
      const {
        agentState: newAgentState,
        shouldEndTurn: llmShouldEndTurn,
        messageId,
        nResponses: generatedResponses,
      } = await runAgentStep({
        ...params,

        agentState: currentAgentState,
        agentTemplate,
        n,
        prompt: currentPrompt,
        runId,
        spawnParams: currentParams,
        system,
        tools,
        additionalToolDefinitions: additionalToolDefinitionsWithCache,
      })

      if (newAgentState.runId) {
        await addAgentStep({
          ...params,
          agentRunId: newAgentState.runId,
          stepNumber: totalSteps,
          credits: newAgentState.directCreditsUsed - creditsBefore,
          childRunIds: newAgentState.childRunIds.slice(childrenBefore),
          messageId,
          status: 'completed',
          startTime,
        })
      } else {
        logger.error('No runId found for agent state after finishing agent run')
      }

      currentAgentState = newAgentState
      shouldEndTurn = llmShouldEndTurn
      nResponses = generatedResponses

      currentPrompt = undefined
      currentParams = undefined
    }

    if (clearUserPromptMessagesAfterResponse) {
      currentAgentState.messageHistory = expireMessages(
        currentAgentState.messageHistory,
        'userPrompt',
      )
    }

    const status = signal.aborted ? 'cancelled' : 'completed'
    await finishAgentRun({
      ...params,
      runId,
      status,
      totalSteps,
      directCredits: currentAgentState.directCreditsUsed,
      totalCredits: currentAgentState.creditsUsed,
    })

    return {
      agentState: currentAgentState,
      output: getAgentOutput(currentAgentState, agentTemplate),
    }
  } catch (error) {
    logger.error(
      {
        error: getErrorObject(error),
        agentType,
        agentId: currentAgentState.agentId,
        runId,
        totalSteps,
        directCreditsUsed: currentAgentState.directCreditsUsed,
        creditsUsed: currentAgentState.creditsUsed,
        messageHistory: currentAgentState.messageHistory,
        systemPrompt: system,
      },
      'Agent execution failed',
    )

    let errorMessage = ''
    if (error instanceof APICallError) {
      errorMessage = `${error.message}`
    } else {
      errorMessage =
        error instanceof Error
          ? error.message + (error.stack ? `\n\n${error.stack}` : '')
          : String(error)
    }

    const statusCode = (error as { statusCode?: number }).statusCode

    const status = signal.aborted ? 'cancelled' : 'failed'
    await finishAgentRun({
      ...params,
      runId,
      status,
      totalSteps,
      directCredits: currentAgentState.directCreditsUsed,
      totalCredits: currentAgentState.creditsUsed,
      errorMessage,
    })

    // Payment required errors (402) should propagate
    if (statusCode === 402) {
      throw error
    }

    return {
      agentState: currentAgentState,
      output: {
        type: 'error',
        message: 'Agent run error: ' + errorMessage,
        ...(statusCode !== undefined && { statusCode }),
      },
    }
  }
}
