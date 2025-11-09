import {
    extension_settings
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
const extensionName = "message-limiter";
// 插件设置的快捷方式
const extensionSettings = () => extension_settings[extensionName];

// 插件的默认设置
const defaultSettings = {
    isEnabled: false,
    messageLimit: 20,
};

// --- HTML 和 CSS 模板 ---

const settingsHtml = `
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>聊天消息数量限制器</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div class="chat-limiter-setting-item">
            <label for="chat-limiter-enabled">启用插件</label>
            <div class="SillyTavernSwitch">
                <input id="chat-limiter-enabled" type="checkbox">
                <label for="chat-limiter-enabled"></label>
            </div>
        </div>
        <div class="chat-limiter-setting-item">
            <label for="chat-limiter-count">显示的消息数量</label>
            <input id="chat-limiter-count" type="number" class="text_pole" min="1" max="500" placeholder="例如: 20">
        </div>
        <div class="description">
            实时限制聊天界面显示的消息数量。只影响视觉显示，不会删除任何实际的聊天数据。关闭插件后将恢复正常显示。
        </div>
    </div>
</div>
`;

const buttonHtml = `
<button id="chat-limiter-toggle" class="fa-solid fa-arrows-down-to-line" title="切换聊天消息数量限制"></button>
`;

const styleCss = `
#chat-limiter-toggle.limiter-active {
    color: var(--accent-color);
    background-color: var(--accent-color-transparent);
}

#chat-limiter-toggle.limiter-active:hover {
    color: var(--accent-color-hover);
    background-color: var(--accent-color-transparent-hover);
}

.chat-limiter-setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}
`;

// --- 插件逻辑 ---

/**
 * 加载插件设置，如果不存在则使用默认值
 */
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName],
    });

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
        applyMessageLimit();
    } else {
        reloadCurrentChat();
    }
}

/**
 * 核心功能：应用消息数量限制。
 */
function applyMessageLimit() {
    if (!extensionSettings().isEnabled) {
        // 如果插件被禁用，但当前视图是受限的，需要重新加载以恢复完整视图
        // 我们通过检查是否存在一个特殊的标记来判断
        if ($('#chat').attr('data-limiter-active')) {
            reloadCurrentChat();
        }
        return;
    }
    
    // 给聊天窗口添加一个标记，表示它当前是受限视图
    $('#chat').attr('data-limiter-active', 'true');

    if ($('#chat .edit_textarea').length > 0) {
        console.log("[Chat Limiter] 用户正在编辑消息，已取消重绘。");
        return;
    }

    const limit = extensionSettings().messageLimit;
    if (limit <= 0) return;

    clearChat();

    const messagesToDisplay = chat.slice(-limit);

    messagesToDisplay.forEach(message => {
        const originalIndex = chat.indexOf(message);
        addOneMessage(message, {
            scroll: false,
            forceId: originalIndex
        });
    });

    refreshSwipeButtons();
    scrollChatToBottom();
    $('#show_more_messages').remove();
}

/**
 * 处理新消息的增量更新
 */
function handleNewMessage() {
    if (!extensionSettings().isEnabled) return;

    setTimeout(() => {
        const limit = extensionSettings().messageLimit;
        const messageElements = $('#chat .mes');

        if (messageElements.length > limit) {
            messageElements.first().remove();
        }
    }, 0);
}

/**
 * 处理消息删除后的视图补充
 */
function handleDeletedMessage() {
    if (!extensionSettings().isEnabled) return;

    setTimeout(() => {
        const limit = extensionSettings().messageLimit;
        const messageElements = $('#chat .mes');
        const currentCount = messageElements.length;

        if (currentCount < limit && chat.length > currentCount) {
            const oldestMesId = parseInt(messageElements.first().attr('mesid'));
            const messageToAddIndex = oldestMesId - 1;

            if (messageToAddIndex >= 0) {
                addOneMessage(chat[messageToAddIndex], {
                    scroll: false,
                    forceId: messageToAddIndex,
                    insertBefore: oldestMesId
                });
            }
        }
    }, 0);
}

// 插件主入口
jQuery(async () => {
    // 1. 将CSS注入到页面
    $('head').append(`<style>${styleCss}</style>`);

    // 2. 将HTML注入到页面
    $('#extensions_settings').append(settingsHtml);
    $('#data_bank_wand_container').append(buttonHtml);

    // 3. 绑定UI事件
    $('#chat-limiter-enabled, #chat-limiter-count').on('change', onSettingsChange);
    $('#chat-limiter-toggle').on('click', onToggleClick);

    // 4. 绑定SillyTavern核心事件
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // 当聊天切换时，移除标记，让applyMessageLimit决定是否重绘
        $('#chat').removeAttr('data-limiter-active');
        applyMessageLimit();
    });
    eventSource.on(event_types.MESSAGE_DELETED, handleDeletedMessage);
    eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
    eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);

    // 5. 加载设置
    loadSettings();

    console.log(`[${extensionName}] Plugin loaded successfully.`);
});
