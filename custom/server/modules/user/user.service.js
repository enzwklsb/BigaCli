import { AppError } from '../../shared/utils.js';
import { appendQueue, queueItems, queueWithItems, queueEditing } from '../scheduled-messages/services/queued-message.service.js';
/**
 * The longest a draft scope or preference key may be.
 *
 * Scopes are session UUIDs or `project:<id>`, and preference keys are fixed
 * identifiers, so anything longer is a client bug or an attempt to use the
 * table as general storage.
 */
const MAX_KEY_LENGTH = 200;
/** Guards against a runaway composer filling the database with one row. */
const MAX_DRAFT_TEXT_LENGTH = 100_000;
const readDraftScope = (value) => {
    const scope = typeof value === 'string' ? value.trim() : '';
    if (!scope || scope.length > MAX_KEY_LENGTH) {
        throw new AppError('A draft scope of 1-200 characters is required', {
            code: 'INVALID_DRAFT_SCOPE',
            statusCode: 400,
        });
    }
    return scope;
};
const readPreferenceUpdates = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new AppError('Preferences must be sent as an object', {
            code: 'INVALID_PREFERENCES',
            statusCode: 400,
        });
    }
    const updates = body;
    for (const key of Object.keys(updates)) {
        if (!key || key.length > MAX_KEY_LENGTH) {
            throw new AppError('Preference keys must be 1-200 characters', {
                code: 'INVALID_PREFERENCE_KEY',
                statusCode: 400,
            });
        }
    }
    return updates;
};
/** Creates user-profile workflows with explicit repository and Git adapters. */
export function createUserService(dependencies) {
    return {
        async getGitConfig(userId) {
            let gitConfig = dependencies.users.getGitConfig(userId);
            if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
                const systemConfig = await dependencies.readSystemGitConfig();
                if (systemConfig.git_name || systemConfig.git_email) {
                    dependencies.users.updateGitConfig(userId, systemConfig.git_name, systemConfig.git_email);
                    gitConfig = systemConfig;
                    dependencies.logInfo(`Auto-populated Git config for user ${userId}`);
                }
            }
            return {
                success: true,
                gitName: gitConfig?.git_name ?? null,
                gitEmail: gitConfig?.git_email ?? null,
            };
        },
        async updateGitConfig(userId, gitNameInput, gitEmailInput) {
            const gitName = typeof gitNameInput === 'string' ? gitNameInput.trim() : '';
            const gitEmail = typeof gitEmailInput === 'string' ? gitEmailInput.trim() : '';
            if (!gitName || !gitEmail) {
                throw new AppError('Git name and email are required', {
                    code: 'GIT_CONFIG_REQUIRED',
                    statusCode: 400,
                });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail)) {
                throw new AppError('Invalid email format', {
                    code: 'INVALID_GIT_EMAIL',
                    statusCode: 400,
                });
            }
            dependencies.users.updateGitConfig(userId, gitName, gitEmail);
            try {
                await dependencies.applyGlobalGitConfig(gitName, gitEmail);
            }
            catch (error) {
                // Persisted user settings remain authoritative even if the host Git
                // installation cannot be updated (matching the previous behavior).
                dependencies.logError('Failed to apply global Git config', error);
            }
            return { success: true, gitName, gitEmail };
        },
        completeOnboarding(userId) {
            dependencies.users.completeOnboarding(userId);
            return { success: true, message: 'Onboarding completed successfully' };
        },
        getOnboardingStatus(userId) {
            return {
                success: true,
                hasCompletedOnboarding: dependencies.users.hasCompletedOnboarding(userId),
            };
        },
        /** Every stored preference at once; the client fills gaps with its defaults. */
        getPreferences(userId) {
            return { success: true, preferences: dependencies.preferences.getPreferences(userId) };
        },
        /**
         * Merge-patch: only the keys in the request body are touched, so two
         * independent settings screens can save concurrently without one erasing
         * the other's work.
         */
        savePreferences(userId, body) {
            const updates = readPreferenceUpdates(body);
            dependencies.preferences.savePreferences(userId, updates);
            return { success: true, preferences: dependencies.preferences.getPreferences(userId) };
        },
        getDrafts(userId) {
            return { success: true, drafts: dependencies.drafts.getDrafts(userId) };
        },
        saveDraft(userId, scopeInput, body) {
            const scope = readDraftScope(scopeInput);
            const payload = (body ?? {});
            const existing = dependencies.drafts.getDrafts(userId).find(d => d.scope === scope);
            const text = payload.appendQueued || payload.queueAction ? (existing?.text || '') : typeof payload.text === 'string' ? payload.text : '';
            let queuedMessage = payload.queuedMessage ?? null;
            if (payload.appendQueued && queuedMessage) queuedMessage=appendQueue(existing?.queuedMessage,queuedMessage);
            if(payload.queueAction){
                queuedMessage=existing?.queuedMessage;
                const items=queueItems(queuedMessage),item=items.find(i=>i.id===payload.itemId);
                if(!item)throw new AppError('排队消息已发送或已删除。',{statusCode:409});
                const owner=String(payload.owner || '');
                if(queueEditing(queuedMessage)&&queuedMessage.editing.owner!==owner)throw new AppError('这条队列正在其他页面编辑。',{statusCode:409});
                if(payload.queueAction==='edit-open'){
                    if(!owner)throw new AppError('Missing editor identifier',{statusCode:400});
                    queuedMessage={...queueWithItems(queuedMessage,items),editing:{owner,itemId:item.id,until:Date.now()+90000}};
                }else if(['edit-save','edit-close'].includes(payload.queueAction)){
                    if(queuedMessage.editing?.owner!==owner)throw new AppError('编辑状态已变化，请重新打开。',{statusCode:409});
                    if(typeof payload.content==='string'){
                        if(payload.content.length>MAX_DRAFT_TEXT_LENGTH)throw new AppError('Draft text is too long to store',{statusCode:413});
                        item.content=payload.content;
                    }
                    queuedMessage=queueWithItems(queuedMessage,items);
                    if(payload.queueAction==='edit-close')delete queuedMessage.editing;
                    else queuedMessage.editing.until=Date.now()+90000;
                }else if(payload.queueAction==='delete')queuedMessage=queueWithItems(queuedMessage,items.filter(i=>i.id!==item.id));
                else throw new AppError('Invalid queue operation',{statusCode:400});
            }
            if (text.length > MAX_DRAFT_TEXT_LENGTH) {
                throw new AppError('Draft text is too long to store', {
                    code: 'DRAFT_TEXT_TOO_LONG',
                    statusCode: 413,
                });
            }
            dependencies.drafts.saveDraft(userId, scope, {
                text,
                queuedMessage,
            });
            if(payload.appendQueued || payload.queueAction==='edit-close')setImmediate(async()=>{
                try{
                    const [{dispatchQueuedMessages},{providerRuntimeService}]=await Promise.all([
                        import('../scheduled-messages/services/scheduled-message-dispatcher.service.js'),
                        import('../providers/services/provider-runtime.service.js'),
                    ]);
                    await dispatchQueuedMessages(providerRuntimeService);
                }catch(error){dependencies.logError('Queued message dispatch failed',error)}
            });
            return { success: true, queuedMessage };
        },
        deleteDraft(userId, scopeInput) {
            dependencies.drafts.deleteDraft(userId, readDraftScope(scopeInput));
            return { success: true };
        },
    };
}
//# sourceMappingURL=user.service.js.map
