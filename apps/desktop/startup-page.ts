import type { StartupFailure, StartupState } from './startup.js';

const commands = {
  quit: 'https://agent-startup.invalid/quit',
  restart: 'https://agent-startup.invalid/restart',
  retry: 'https://agent-startup.invalid/retry',
} as const;
const failures: Record<StartupFailure, [string, string]> = {
  'key-missing': [
    '缺少加密数据密钥',
    '此目录已有数据，但找不到原数据密钥。请恢复原 data-key.enc；应用不会创建替代密钥。',
  ],
  'key-invalid': ['数据密钥无效', '读取到的数据密钥格式不正确。请检查原加密密钥文件，已有数据已保留。'],
  'key-unverified': ['无法确认数据密钥身份', '此旧目录缺少可验证的密钥依据，需要显式迁移。已有数据已保留。'],
  'data-unreadable': [
    '无法读取加密数据',
    '密钥与现有数据不匹配，或加密文件已损坏。请检查原密钥和备份，已有文件已保留。',
  ],
  'storage-unavailable': [
    '系统安全存储暂不可用',
    '可能未获授权、已取消访问或钥匙串暂不可访问。请在 macOS 中正常授权或解锁钥匙串，再重新启动。',
  ],
  'storage-failed': ['未能读取安全密钥', '系统未提供可区分的失败原因。请检查系统安全存储和数据目录权限，再重新启动。'],
  'host-failed': ['服务启动失败', '请检查数据目录是否正被其他服务使用，或端口是否可用，然后重试。'],
  'page-failed': ['无法打开应用页面', '本地服务页面未能加载。可以重试启动或退出应用。'],
};
export function startupAction(
  target: string,
  currentUrl: string,
  startupUrl: string,
  mainFrame: boolean,
  state: StartupState,
) {
  if (!startupUrl || currentUrl !== startupUrl || !mainFrame || state.phase === 'ready' || state.phase === 'quitting')
    return;
  if (target === commands.quit) return 'quit';
  if (state.phase !== 'failed') return;
  if (target === commands.restart && !state.retryHost) return 'restart';
  if (target === commands.retry && state.retryHost) return 'retry';
}
export function startupPage(state: StartupState): string {
  let title: string, detail: string;
  if (state.phase === 'failed') [title, detail] = failures[state.code];
  else if (state.phase === 'accessing') {
    title = state.slow ? '仍在等待系统安全存储' : '正在访问系统安全存储';
    detail = '如 macOS 显示钥匙串提示，请检查应用身份并正常授权。系统操作尚未完成；你也可以退出应用。';
  } else if (state.phase === 'starting' || state.phase === 'recovering') {
    title = state.phase === 'recovering' ? '正在恢复本地服务' : '正在启动本地服务';
    detail = state.slow ? '服务尚未就绪。可以继续等待或退出应用。' : '正在恢复会话和本地数据。';
  } else if (state.phase === 'quitting') {
    title = '正在退出';
    detail = '正在结束启动操作。';
  } else {
    title = '正在恢复数据';
    detail = '正在读取加密数据密钥。';
  }
  const action =
    state.phase === 'failed'
      ? `<a href="${state.retryHost ? commands.retry : commands.restart}">${state.retryHost ? '重试启动' : '重新启动'}</a>`
      : '';
  const quit = state.phase === 'quitting' ? '' : `<a href="${commands.quit}">退出 Agent</a>`;
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-startup'; base-uri 'none'; form-action 'none'; frame-src 'none'"><meta name="viewport" content="width=device-width"><title>Agent</title><style nonce="startup">:root{color-scheme:light}body{margin:0;background:#f6f5f1;color:#272a26;font:16px/1.7 system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}main{width:min(480px,calc(100% - 64px));padding:48px 0}.name{font-size:14px;color:#676b61;margin-bottom:24px}h1{font-size:26px;line-height:1.4;font-weight:600;margin:0 0 16px}p{color:#5c6258;margin:0 0 32px}nav{display:flex;gap:16px}a{color:#294834;text-decoration:none;border:1px solid #bfc8b9;padding:8px 18px;border-radius:6px}a:focus-visible{outline:2px solid #294834;outline-offset:4px}</style><main data-startup-phase="${state.phase}"><div class="name">Agent</div><h1>${title}</h1><p role="status">${detail}</p><nav>${action}${quit}</nav></main></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
