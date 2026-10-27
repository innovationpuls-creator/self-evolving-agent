import { files } from './model';

// Design-only event records. Each call has its own arguments and paired result.
export const loopTools = [
  {
    id: 'read',
    tool: 'read',
    purpose: '读取旧版项目说明',
    target: files[0],
    status: 'success',
    time: '14:32:06',
    result: '已返回正文：密码登录，本地保存数据。',
    input: { path: files[0] },
    output: { content: '# 项目说明 v1\n使用用户名与密码登录。数据保存在本地。', complete: true },
  },
  {
    id: 'read-v2',
    tool: 'read',
    purpose: '读取新版项目说明',
    target: files[1],
    status: 'success',
    time: '14:32:07',
    result: '已返回正文：设备授权，增加备份与恢复说明。',
    input: { path: files[1] },
    output: { content: '# 项目说明 v2\n在浏览器完成设备授权。支持加密备份并恢复到新目录。', complete: true },
  },
  {
    id: 'diff',
    tool: 'text_diff',
    purpose: '比较正文变化',
    target: `${files[0]} → ${files[1]}`,
    status: 'success',
    time: '14:32:08',
    result: '返回 2 处变化：身份认证、数据恢复。',
    input: { before: files[0], after: files[1], options: { contextLines: 3, ignoreWhitespace: false } },
    output: {
      changes: [
        { section: '身份认证', kind: 'modified', before: '用户名与密码', after: '浏览器设备授权' },
        { section: '数据恢复', kind: 'added', before: null, after: '加密备份，恢复到新目录' },
      ],
    },
  },
  {
    id: 'fail',
    tool: 'read',
    purpose: '核实旧版兼容承诺',
    target: files[2],
    status: 'error',
    time: '14:32:09',
    result: 'ENOENT · 文件不存在；错误也会返回给模型。',
    input: { path: files[2] },
    output: { code: 'ENOENT', message: '文件不存在', path: files[2] },
  },
  {
    id: 'unknown',
    tool: 'document_info',
    purpose: '查询文档元数据',
    target: files[1],
    status: 'unknown',
    time: '14:32:10',
    result: '返回编码与标签；没有提供旧版兼容性的依据。',
    input: { path: files[1] },
    output: {
      schemaVersion: 2,
      data: [{ path: files[1], metadata: { encoding: 'utf-8', tags: ['draft', 'review'], source: null } }],
    },
  },
] as const;

export const loopSteps = [
  {
    id: 1,
    title: '先读取两份正文',
    time: '14:32:05',
    input: '用户请求与文件引用',
    text: '我先读取两版项目说明，再比较变化与影响。兼容范围需要另外核实。',
    calls: ['read', 'read-v2'],
    end: 'toolUse',
    next: '两份正文已写回上下文，继续请求模型。',
  },
  {
    id: 2,
    title: '比较差异，同时核实兼容说明',
    time: '14:32:08',
    input: '原有上下文 + 2 条文件读取结果',
    text: '正文已读取。我会比较身份认证和数据恢复的变化，并读取兼容附件，确认旧客户端的支持范围。',
    calls: ['diff', 'fail'],
    end: 'toolUse',
    next: '差异结果与文件错误均已写回上下文，模型继续处理。',
  },
  {
    id: 3,
    title: '收到读取错误后继续检查',
    time: '14:32:10',
    input: '原有上下文 + 差异结果 + ENOENT 错误',
    text: '兼容说明不存在，暂时无法确认旧客户端是否可用。我再检查新版文档的元数据，看看是否有补充来源。',
    calls: ['unknown'],
    end: 'toolUse',
    next: '元数据已写回上下文，继续请求模型。',
  },
  {
    id: 4,
    title: '给出结果，结束本次循环',
    time: '14:32:14',
    input: '原有上下文 + 文档元数据',
    text: '两版正文有两类主要变化：登录从密码改为设备授权；新增了加密备份与恢复到新目录的说明。兼容附件缺失，元数据也没有补充依据，因此旧版支持范围仍需确认。',
    calls: [],
    end: 'stop',
    next: '模型没有继续请求工具，本次执行结束。',
  },
] as const;

export function loopTool(id: string) {
  const call = loopTools.find((tool) => tool.id === id);
  if (!call) throw new Error(`Unknown Demo tool record: ${id}`);
  return call;
}

export function modelRecord(step: (typeof loopSteps)[number]) {
  return {
    role: 'assistant' as const,
    content: step.text,
    stopReason: step.end,
    toolCalls: step.calls.map((id) => {
      const call = loopTool(id);
      return { id: `call_demo_${id}`, name: call.tool, arguments: call.input };
    }),
  };
}

export function callRecord(id: string) {
  const call = loopTool(id);
  return {
    role: 'toolResult' as const,
    toolName: call.tool,
    toolCallId: `call_demo_${call.id}`,
    input: call.input,
    output: call.output,
    isError: call.status === 'error',
    durationMs: null,
  };
}

export function stepContext(step: number, request: string) {
  return [
    { role: 'user' as const, content: request, references: files.slice(0, 2) },
    ...loopSteps.filter((s) => s.id < step).flatMap((s) => [modelRecord(s), ...s.calls.map(callRecord)]),
  ];
}
