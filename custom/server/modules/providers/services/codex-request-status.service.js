export const firstResponseWaitText = '尚未收到模型响应。请检查网络或模型容量；若刚切换到新模型，请检查 BigaCli 更新（包含 Codex CLI），确认客户端兼容性。';
export const clientUpgradeText = '当前 Codex CLI 版本不满足模型要求，请检查 BigaCli 更新后再使用该模型。';

export function describeCodexRequestError(error, willRetry) {
    const detail = [error?.message, error?.additionalDetails].filter(Boolean).join('\n');
    const code = JSON.stringify(error?.codexErrorInfo || '');
    if (/Selected model is at capacity|ServerOverloaded|PolicyCapacityUnavailable/i.test(detail + code)) {
        return {
            text: willRetry
                ? '当前模型容量已满，Codex 正在等待重试。你可以停止任务后换用其他模型，或继续等待。'
                : '当前模型容量已满，请稍后重试或换用其他模型。',
            detail,
        };
    }
    if (/(?:upgrade|update).*(?:codex|client|cli)|(?:codex|client|cli).*(?:outdated|too old|minimum version)|requires? (?:a )?newer.*(?:codex|client|cli)|requires?.*(?:codex|client|cli).*\d+\.\d+/i.test(detail)) {
        return { text: clientUpgradeText, detail };
    }
    return {
        text: willRetry ? '模型请求遇到错误，Codex 正在重试。' : '模型请求失败。',
        detail: detail || 'Codex 未返回错误详情。',
    };
}
