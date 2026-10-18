import {Type} from 'typebox';

export default function receipt(pi) {
  pi.registerTool({
    name: 'd2_receipt',
    label: 'Receipt',
    description: 'Produce a D2 Skill acceptance receipt for the supplied value.',
    exposure: 'deferred',
    parameters: Type.Object({value: Type.String()}),
    async execute(_id, {value}) {
      return {content: [{type: 'text', text: `D2_RECEIPT:${value}`}], details: {value}};
    },
  });
}
