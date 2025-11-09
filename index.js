import {
    extension_settings,
    renderExtensionTemplateAsync
} from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    chat,
    clearChat,
    addOneMessage,
    refreshSwipeButtons,
    scrollChatToBottom,
    reloadCurrentChat
} from '../../../../script.js';

// 插件的唯一名称，必须与文件夹名一致
const extensionName = "chat-limiter";
// 插件设置的快捷方式
const extensionSettings = () => extension_settings[extensionName];

// 插件的默认设置
const defaultSettings = {
    isEnabled: false,
    messageLimit: 20,
};

/**
 * 加载插件设置，如果不存在则使用默认值
 */
function loadSettings() {
    // 确保设置对象存在
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    // 合并默认设置和已保存的设置
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName],
    });

    // 更新UI元素的状态以匹配设置
    $('#chat-limiter-enabled').prop('checked', extensionSettings().isEnabled);
    $('#chat-limiter-count').val(extensionSettings().messageLimit);
    updateToggleButtonState();
}

/**
 * 更新主界面切换按钮的视觉状态
 */
function updateToggleButtonState() {
    const isActive = extensionSettings().isEnabled;
    $('#chat-limiter-toggle').toggleClass('limiter-active', isActive);
}

/**
 * 当设置面板中的值发生变化时调用
 */
function onSettingsChange() {
    extensionSettings().isEnabled = $('#chat-limiter-enabled').is(':checked');
    extensionSettings().messageLimit = Number($('#chat-limiter-count').val());
    saveSettingsDebounced();
    updateToggleButtonState();

    // 如果设置发生变化，立即应用限制
    applyMessageLimit();
}

/**
 * 主界面切换按钮的点击事件处理
 */
function onToggleClick() {
    extensionSettings().isEnabled = !extensionSettings().isEnabled;
    saveSettingsDebounced();
    updateToggleButtonState();

    if (extensionSettings().isEnabled) {
        // 启用时，立即应用限制
        applyMessageLimit();
    } else {
        // 禁用时，重新加载聊天以显示所有消息
        reloadCurrentChat();
    }
}

/**
 * 核心功能：应用消息数量限制。
 * 这是一个“完全重绘”函数，用于初始化或在需要时刷新整个受限视图。
 */
function applyMessageLimit() {
    // 如果插件未启用，则不执行任何操作
    if (!extensionSettings().isEnabled) {
        return;
    }

    // 安全检查：如果用户正在编辑消息，则中止操作以防丢失输入
    if ($('#chat .edit_textarea').length > 0) {
        console.log("[Chat Limiter] 用户正在编辑消息，已取消重绘。");
        return;
    }

    const limit = extensionSettings().messageLimit;
    if (limit <= 0) return;

    // 清空当前的聊天DOM
    clearChat();

    // 从完整的 `chat` 数组中获取最后 `limit` 条消息
    const messagesToDisplay = chat.slice(-limit);

    // 逐条渲染这些消息
    messagesToDisplay.forEach(message => {
        const originalIndex = chat.indexOf(message);
        addOneMessage(message, {
            scroll: false, // 在循环中禁止滚动
            forceId: originalIndex // 关键：确保DOM的mesid与它在完整chat数组中的索引一致
        });
    });

    // 渲染完成后，刷新UI并滚动到底部
    refreshSwipeButtons();
    scrollChatToBottom();

    // 移除与本插件功能冲突的“加载更多消息”按钮
    $('#show_more_messages').remove();
}

/**
 * 处理新消息的增量更新，比完全重绘更高效。
 */
function handleNewMessage() {
    if (!extensionSettings().isEnabled) return;

    // 使用setTimeout确保此代码在SillyTavern的原生addOneMessage之后执行
    setTimeout(() => {
        const limit = extensionSettings().messageLimit;
        const messageElements = $('#chat .mes');

        // 如果DOM中的消息数量超过了限制，则移除最旧的一条
        if (messageElements.length > limit) {
            messageElements.first().remove();
        }
    }, 0);
}

/**
 * 处理消息删除后的视图补充。
 */
function handleDeletedMessage() {
    if (!extensionSettings().isEnabled) return;

    // 同样使用setTimeout确保在原生删除操作后执行
    setTimeout(() => {
        const limit = extensionSettings().messageLimit;
        const messageElements = $('#chat .mes');
        const currentCount = messageElements.length;

        // 如果DOM消息数小于限制，并且后端还有更多历史消息，则进行补充
        if (currentCount < limit && chat.length > currentCount) {
            // 找到当前显示的最老消息的ID
            const oldestMesId = parseInt(messageElements.first().attr('mesid'));
            
            // 计算需要补充的消息在完整chat数组中的索引
            const messageToAddIndex = oldestMesId - 1;

            if (messageToAddIndex >= 0) {
                // 在顶部插入这条更早的消息
                addOneMessage(chat[messageToAddIndex], {
                    scroll: false,
                    forceId: messageToAddIndex,
                    insertBefore: oldestMesId // 在最老的消息前面插入
                });
            }
        }
    }, 0);
}

// 插件主入口
jQuery(async () => {
    // 1. 加载并注入UI模板
    try {
        const settingsHtml = await renderExtensionTemplateAsync(extensionName, 'settings');
        $('#extensions_settings').append(settingsHtml);
        
        const buttonHtml = await renderExtensionTemplateAsync(extensionName, 'button');
        $('#data_bank_wand_container').append(buttonHtml);
    } catch (error) {
        console.error(`[${extensionName}] Failed to load templates:`, error);
        return;
    }

    // 2. 绑定UI事件
    $('#chat-limiter-enabled, #chat-limiter-count').on('change', onSettingsChange);
    $('#chat-limiter-toggle').on('click', onToggleClick);

    // 3. 绑定SillyTavern核心事件
    eventSource.on(event_types.CHAT_CHANGED, applyMessageLimit);
    eventSource.on(event_types.MESSAGE_DELETED, handleDeletedMessage); // 使用更精细的删除处理
    eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
    eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);

    // 4. 加载设置
    loadSettings();

    console.log(`[${extensionName}] Plugin loaded successfully.`);
});
