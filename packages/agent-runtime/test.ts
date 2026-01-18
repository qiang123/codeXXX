import z from 'zod/v4'

import type { ZodObject } from 'zod/v4'

const endsAgentStepParam = 'easp'


function paramsSection(params: { schema: z.ZodType; endsAgentStep: boolean }) {
  const { schema, endsAgentStep } = params
  const schemaWithEndsAgentStepParam = z.toJSONSchema(
    endsAgentStep
      ? (schema as ZodObject).merge(
          z.object({
            [endsAgentStepParam]: z
              .literal(endsAgentStep)
              .describe('Easp flag must be set to true'),
          }),
        )
      : schema,
    { io: 'input' },
  )

  const jsonSchema = schemaWithEndsAgentStepParam
  delete jsonSchema.description
  delete jsonSchema['$schema']
  const paramsDescription = Object.keys(jsonSchema.properties ?? {}).length
    ? JSON.stringify(jsonSchema, null, 2)
    : 'None'

  let paramsSection = ''
  if (paramsDescription.length === 1 && paramsDescription[0] === 'None') {
    paramsSection = 'Params: None'
  } else if (paramsDescription.length > 0) {
    paramsSection = `Params: ${paramsDescription}`
  }
  return paramsSection
}

const schema = z.object({ propA: z.string() })

const schema2 = z.object({ propA: z.string() })

const  = z.object({
   inputSchema: z.custom<z.ZodType>(),
})

console.log(paramsSection({ schema, endsAgentStep: false }))
console.log(paramsSection({ schema, endsAgentStep: true }))

console.log(paramsSection({ schema: c.inpu, endsAgentStep: true }))
