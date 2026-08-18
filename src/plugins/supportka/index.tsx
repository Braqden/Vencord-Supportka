/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brqden_
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { debounce } from "@shared/debounce";
import { classNameFactory } from "@utils/css";
import gitHash from "~git-hash";
import definePlugin, { OptionType } from "@utils/types";
import { Message, RenderModalProps, User } from "@vencord/discord-types";
import { createRoot, Forms, Modal, openModal, RestAPI, SelectedGuildStore, showToast, TextInput, Toasts, useCallback, useEffect, useMemo, useRef, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";
import { JSX, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Root } from "react-dom/client";

import { DEFAULT_MEMO, DEFAULT_MODERATION_MEMO } from "./memo";
import { OverlayOptions, OverlayRole, startOverlay, stopOverlay } from "./overlay";
import { getSymbolImage } from "./symbols";

const DEFAULT_BOY_CHANNEL = "852418390618275891";
const DEFAULT_GIRL_CHANNEL = "853603250443780116";
const DEFAULT_REJECT_CHANNEL = "852418435031498752";

const DEFAULT_RELAY_GUILD_ID = "1535963962053632120";

const MEMO_VERSION = "v3.5.0";
const DEFAULT_RELAY_CHANNEL_ID = "1535964031276294235";
const DEFAULT_CONTROLLER_ID = "611522379776000001";

const DEFAULT_OVERLAY_GUILD_ID = "254958490676625408";

const DEFAULT_OVERLAY_ENTRIES = [
    "848876547792306217|сапорт|0",
    "848876541009592341|куратор|0",
    "848876539000258572|администратор|0",
    "852416528598040626|новичок|1"
].join("\n");

const OLD_REJECT_PRESETS = "АртёмВавилов;Запрещённая символика;Пропаганда наркотиков;Оскорбления;Ссылки без спойлера;Перезаходит в прихожую;Возраст";
const DEFAULT_REJECT_PRESETS = "Молчит в войсе, в лс отписано;АртёмВавилов;12 лет, ;Оскорбляет";

const COMMAND_TYPE = "vc-supportka";

const CHANNEL_CACHE_KEY = "vc-supportka-channels";
const LAST_PROCESSED_KEY = "vc-supportka-last-processed";

const cl = classNameFactory("vc-supportka-");

const settings = definePluginSettings({
    boyChannelId: {
        type: OptionType.STRING,
        displayName: "Канал «Мальчик»",
        description: "Канал, куда отправляется сообщение при нажатии Мальчик.",
        default: DEFAULT_BOY_CHANNEL
    },
    girlChannelId: {
        type: OptionType.STRING,
        displayName: "Канал «Девочка»",
        description: "Канал, куда отправляется сообщение при нажатии Девочка.",
        default: DEFAULT_GIRL_CHANNEL
    },
    rejectChannelId: {
        type: OptionType.STRING,
        displayName: "Канал «Отказ»",
        description: "Канал, куда отправляется сообщение при нажатии Отказ.",
        default: DEFAULT_REJECT_CHANNEL
    },
    sendCommands: {
        type: OptionType.BOOLEAN,
        displayName: "Отправлять команды",
        description: "Не включать — вам это не нужно, оно всё равно работать не будет.",
        default: false
    },
    executeCommands: {
        type: OptionType.BOOLEAN,
        displayName: "Выполнять команды",
        description: "Не включать — вам это не нужно, оно всё равно работать не будет.",
        default: false
    },
    overlayEnabled: {
        type: OptionType.BOOLEAN,
        displayName: "Значки ролей в оверлее",
        description: "В игровом оверлее Discord показывать у участников голосового канала метку их роли. Данные передаются из главного окна Discord.",
        default: false,
        onChange: (v: boolean) => {
            if (v) startOverlay(buildOverlayOptions());
            else stopOverlay();
        }
    },
    overlayEntries: {
        type: OptionType.STRING,
        multiline: true,
        displayName: "Оверлей: роли",
        description: "Строки в формате: ID роли|подпись|0/1. 0 — подпись исчезнет через 3 сек, останется иконка роли; 1 — подпись остаётся навсегда.",
        default: DEFAULT_OVERLAY_ENTRIES,
        onChange: () => restartOverlay()
    },
    overlayHotkeys: {
        type: OptionType.BOOLEAN,
        displayName: "Горячие клавиши в оверлее",
        description: "В игровом оверлее выбери участника (клик по нему или ↑↓). Q — Мальчик, E — Девочка, R — Отказ (T — следующая причина), U — Размутить, Esc — снять выбор.",
        default: true,
        onChange: () => restartOverlay()
    },
    rejectPresets: {
        type: OptionType.STRING,
        displayName: "Пресеты причин отказа",
        description: "Быстрые причины в окне «Отказ», разделяются ;",
        default: DEFAULT_REJECT_PRESETS
    },
    showMemoButton: {
        type: OptionType.BOOLEAN,
        displayName: "Кнопка «Памятка»",
        description: "Показывать кнопку «Памятка» в верхней панели Discord (между «Почтой» и «Помощью»).",
        default: true
    },
    memoContent: {
        type: OptionType.STRING,
        multiline: true,
        displayName: "Текст памятки «Саппорт»",
        description: "Содержимое памятки «Саппорт». Формат строк: ## заголовок, ### подзаголовок, - пункт, 1. нумерованный пункт, > заметка, --- разделитель, **жирный**, `код`.",
        default: DEFAULT_MEMO
    },
    memoContentModeration: {
        type: OptionType.STRING,
        multiline: true,
        displayName: "Текст памятки «Модерация»",
        description: "Содержимое памятки «Модерация». Тот же формат разметки, что и у «Саппорт».",
        default: DEFAULT_MODERATION_MEMO
    }
});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function parseOverlayEntries(raw: string): OverlayRole[] {
    return raw.split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [roleId, label, persist] = line.split("|");
            return {
                roleId: (roleId ?? "").trim(),
                label: (label ?? "").trim(),
                persist: (persist ?? "").trim() === "1" || (persist ?? "").trim().toLowerCase() === "true"
            };
        })
        .filter(entry => entry.roleId.length > 0);
}

function buildOverlayOptions(): OverlayOptions {
    return {
        guildId: DEFAULT_OVERLAY_GUILD_ID,
        roles: parseOverlayEntries(settings.store.overlayEntries),
        allowMainWindow: settings.store.overlayEnabled,
        hotkeys: {
            enabled: settings.store.overlayHotkeys,
            sendCommands: settings.store.sendCommands,
            boyChannelId: settings.store.boyChannelId,
            girlChannelId: settings.store.girlChannelId,
            rejectChannelId: settings.store.rejectChannelId,
            rejectReasons: settings.store.rejectPresets
                .split(";")
                .map(p => p.trim())
                .filter(Boolean)
        }
    };
}

function restartOverlay() {
    stopOverlay();
    if (settings.store.overlayEnabled) startOverlay(buildOverlayOptions());
}

function setServerMute(guildId: string, userId: string, mute: boolean) {
    if (userId === UserStore.getCurrentUser().id) {
        showToast("Нельзя замьютить/размьютить самого себя", Toasts.Type.FAILURE);
        return;
    }
    RestAPI.patch({
        url: `/guilds/${guildId}/members/${userId}`,
        body: { mute }
    })
        .then(() => showToast(mute ? "Пользователь замьючен" : "Пользователь размьючен", Toasts.Type.SUCCESS))
        .catch(err => showToast(`Не удалось изменить мьют (${err?.response?.status ?? err?.message ?? "нет прав"})`, Toasts.Type.FAILURE));
}

async function sendRawMessage(channelId: string, content: string) {
    await RestAPI.post({ url: `/channels/${channelId}/messages`, body: { content } });
}

type TargetChannel = "boy" | "girl" | "reject";

const CHANNEL_NAMES: Record<TargetChannel, string> = {
    boy: "мальчик",
    girl: "девочка",
    reject: "отказ"
};

function configuredChannelId(type: TargetChannel): string {
    switch (type) {
        case "boy": return settings.store.boyChannelId;
        case "girl": return settings.store.girlChannelId;
        case "reject": return settings.store.rejectChannelId;
    }
}

async function resolveTargetChannel(type: TargetChannel): Promise<string | null> {
    const cache = (await DataStore.get<Record<string, string>>(CHANNEL_CACHE_KEY)) ?? {};
    if (cache[type]) return cache[type];

    const configured = configuredChannelId(type);
    try {
        await RestAPI.get({ url: `/channels/${configured}` });
        return configured;
    } catch {
        // канала нет или нет доступа — пробуем создать
    }

    try {
        const { body } = await RestAPI.post({
            url: `/guilds/${DEFAULT_RELAY_GUILD_ID}/channels`,
            body: { name: CHANNEL_NAMES[type], type: 0 }
        });
        cache[type] = body.id;
        await DataStore.set(CHANNEL_CACHE_KEY, cache);
        showToast(`Сапортка: канал «${CHANNEL_NAMES[type]}» создан автоматически`, Toasts.Type.SUCCESS);
        return body.id;
    } catch {
        return null;
    }
}

async function sendBoy(userId: string) {
    const channel = await resolveTargetChannel("boy");
    if (!channel) {
        showToast("Сапортка: канал «мальчик» недоступен — не удалось создать (нет прав?)", Toasts.Type.FAILURE);
        return;
    }
    await sendRawMessage(channel, userId);
    showToast("Отправлено: Мальчик", Toasts.Type.SUCCESS);
}

async function sendGirl(userId: string) {
    const girlChannel = await resolveTargetChannel("girl");
    const boyChannel = await resolveTargetChannel("boy");
    if (!girlChannel || !boyChannel) {
        showToast("Сапортка: каналы «девочка»/«мальчик» недоступны", Toasts.Type.FAILURE);
        return;
    }
    await sendRawMessage(girlChannel, userId);
    await wait(250);
    await sendRawMessage(boyChannel, userId);
    showToast("Отправлено: Девочка", Toasts.Type.SUCCESS);
}

async function sendReject(userId: string, reason: string) {
    const channel = await resolveTargetChannel("reject");
    if (!channel) {
        showToast("Сапортка: канал «отказ» недоступен — не удалось создать (нет прав?)", Toasts.Type.FAILURE);
        return;
    }
    await sendRawMessage(channel, `${userId} ${reason}`);
    showToast("Отправлено: Отказ", Toasts.Type.SUCCESS);
}

interface SupportCommand {
    type: string;
    action: "boy" | "girl" | "mute" | "unmute" | "reject";
    user: string;
    guild?: string;
    reason?: string;
}

function buildCommand(action: SupportCommand["action"], userId: string, guildId: string, reason?: string): string {
    return JSON.stringify({
        type: COMMAND_TYPE,
        action,
        user: userId,
        guild: guildId,
        reason
    });
}

async function sendCommand(action: SupportCommand["action"], userId: string, guildId: string, reason?: string) {
    try {
        await sendRawMessage(DEFAULT_RELAY_CHANNEL_ID, buildCommand(action, userId, guildId, reason));
        showToast("Команда отправлена Brqden_", Toasts.Type.SUCCESS);
    } catch {
        showToast("Не удалось отправить команду (нет доступа к релей-каналу?)", Toasts.Type.FAILURE);
    }
}

function executeCommand(command: SupportCommand) {
    switch (command.action) {
        case "boy":
            void sendBoy(command.user);
            break;
        case "girl":
            void sendGirl(command.user);
            break;
        case "mute":
        case "unmute":
            if (command.guild) setServerMute(command.guild, command.user, command.action === "mute");
            break;
        case "reject":
            if (command.reason) void sendReject(command.user, command.reason);
            break;
    }
}

let pollTimer: number | undefined;
let lastProcessed: Record<string, string> = {};

async function loadLastProcessed() {
    lastProcessed = (await DataStore.get<Record<string, string>>(LAST_PROCESSED_KEY)) ?? {};
}

function isAlreadyProcessed(channelId: string, messageId?: string) {
    if (!messageId) return false;
    const last = lastProcessed[channelId];
    return Boolean(last && messageId <= last);
}

function markProcessed(channelId: string, messageId?: string) {
    if (!messageId) return;
    lastProcessed[channelId] = messageId;
    void DataStore.set(LAST_PROCESSED_KEY, lastProcessed);
}

function handleRelayMessage(message: { id?: string; channel_id?: string; content?: string; author?: { id?: string; }; }) {
    if (message.channel_id !== DEFAULT_RELAY_CHANNEL_ID) return;
    if (!message.content?.startsWith(`{"type":"${COMMAND_TYPE}"`)) return;
    if (isAlreadyProcessed(message.channel_id, message.id)) return;
    markProcessed(message.channel_id, message.id);

    if (message.author?.id === UserStore.getCurrentUser().id) return;

    if (!settings.store.executeCommands) {
        showToast("Сапортка: получена команда, но «Выполнять команды» выключено", Toasts.Type.FAILURE);
        return;
    }
    if (message.author?.id !== DEFAULT_CONTROLLER_ID) {
        showToast(`Сапортка: команда от неизвестного (${message.author?.id}), ожидался ${DEFAULT_CONTROLLER_ID}`, Toasts.Type.FAILURE);
        return;
    }

    let command: SupportCommand;
    try {
        command = JSON.parse(message.content);
    } catch {
        showToast("Сапортка: не удалось разобрать команду", Toasts.Type.FAILURE);
        return;
    }

    if (command?.type !== COMMAND_TYPE || !command.action || !command.user) {
        showToast("Сапортка: неверный формат команды", Toasts.Type.FAILURE);
        return;
    }

    if (command.user !== UserStore.getCurrentUser().id) return;

    executeCommand(command);
}

let pollInFlight = false;

async function pollRelay() {
    if (pollInFlight) return;
    if (!settings.store.executeCommands) return;
    pollInFlight = true;
    try {
        const { body } = await RestAPI.get({
            url: `/channels/${DEFAULT_RELAY_CHANNEL_ID}/messages?limit=10`
        });
        for (const message of body) handleRelayMessage(message);
    } catch {
        // релей-канал недоступен — ничего не делаем
    } finally {
        pollInFlight = false;
    }
}

async function startPolling() {
    await loadLastProcessed();
    void pollRelay();
    pollTimer = window.setInterval(() => void pollRelay(), 5000);
}

function openRejectModal(userId: string, guildId: string, controller: boolean) {
    openModal(props => (
        <RejectModal userId={userId} guildId={guildId} controller={controller} modalProps={props} />
    ));
}

function RejectModal({ modalProps, userId, guildId, controller }: { modalProps: RenderModalProps; userId: string; guildId: string; controller: boolean; }) {
    const [reason, setReason] = useState("");

    const presets = useMemo(() =>
        settings.store.rejectPresets
            .split(";")
            .map(p => p.trim())
            .filter(Boolean),
        [settings.store.rejectPresets]
    );

    const trimmed = reason.trim();

    function onConfirm() {
        if (!trimmed) return;
        if (controller) {
            void sendCommand("reject", userId, guildId, trimmed);
        } else {
            void sendReject(userId, trimmed);
        }
        modalProps.onClose();
    }

    return (
        <Modal
            {...modalProps}
            title="Отказ"
            actions={[
                { text: "Отмена", variant: "secondary", onClick: () => modalProps.onClose() },
                {
                    text: "Отправить",
                    variant: "critical-primary",
                    disabled: !trimmed,
                    onClick: onConfirm
                }
            ]}
        >
            <Forms.FormTitle tag="h5">Введите причину отказа</Forms.FormTitle>
            <TextInput
                value={reason}
                onChange={setReason}
                placeholder="Например: перезаходит в прихожую 3 раз"
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") onConfirm();
                }}
            />
            {presets.length > 0 && (
                <div className={cl("presets")}>
                    {presets.map(preset => (
                        <Button
                            key={preset}
                            variant="secondary"
                            size="min"
                            onClick={() => setReason(preset)}
                        >
                            {preset}
                        </Button>
                    ))}
                </div>
            )}
        </Modal>
    );
}

const svgIconProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true
} as const;

const MuteIcon = () => (
    <svg {...svgIconProps}>
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
);

const UnmuteIcon = () => (
    <svg {...svgIconProps}>
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
    </svg>
);

const PersonIcon = () => (
    <svg {...svgIconProps}>
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
);

const RejectIcon = () => (
    <svg {...svgIconProps}>
        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
);

const SupportkaButtons = ErrorBoundary.wrap(
    (props: { user?: User; guildId?: string; }) => {
        const { user } = props;
        if (!user?.id) return null;

        const selectedGuildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());

        const voiceState = useStateFromStores(
            [VoiceStateStore],
            () => {
                const guild = props.guildId ?? selectedGuildId;
                return guild
                    ? VoiceStateStore.getVoiceState(guild, user.id)
                    : VoiceStateStore.getVoiceStateForUser(user.id);
            },
            [props.guildId, selectedGuildId, user.id]
        );

        const guildId = props.guildId ?? voiceState?.guildId ?? selectedGuildId;
        if (!guildId) return null;

        const controller = settings.store.sendCommands;
        const inVoice = Boolean(voiceState?.channelId);

        const onMute = () => {
            if (!voiceState) return;
            if (controller) {
                sendCommand(voiceState.mute ? "unmute" : "mute", user.id, guildId);
            } else {
                setServerMute(guildId, user.id, !voiceState.mute);
            }
        };

        const onBoy = () => {
            if (controller) {
                void sendCommand("boy", user.id, guildId);
            } else {
                void sendBoy(user.id);
            }
        };

        const onGirl = () => {
            if (controller) {
                void sendCommand("girl", user.id, guildId);
            } else {
                void sendGirl(user.id);
            }
        };

        const onReject = () => {
            openRejectModal(user.id, guildId, controller);
        };

        return (
            <Flex flexDirection="column" gap={6} style={STYLE_COLUMN}>
                <Button
                    variant="secondary"
                    size="small"
                    className={cl("btn")}
                    style={STYLE_FULL_WIDTH}
                    onClick={onMute}
                    disabled={!inVoice}
                >
                    {voiceState?.mute ? <UnmuteIcon /> : <MuteIcon />}
                    {voiceState?.mute ? "Размутить" : "Замутить"}
                </Button>
                <Flex gap={6}>
                    <Button
                        variant="secondary"
                        size="small"
                        className={cl("boy", "btn")}
                        style={STYLE_FLEX_1}
                        onClick={onBoy}
                    >
                        <PersonIcon />
                        Мальчик
                    </Button>
                    <Button
                        variant="secondary"
                        size="small"
                        className={cl("girl", "btn")}
                        style={STYLE_FLEX_1}
                        onClick={onGirl}
                    >
                        <PersonIcon />
                        Девочка
                    </Button>
                </Flex>
                <Button
                    variant="secondary"
                    size="small"
                    className={cl("reject", "btn")}
                    style={STYLE_FULL_WIDTH}
                    onClick={onReject}
                >
                    <RejectIcon />
                    Отказ
                </Button>
            </Flex>
        );
    },
    { noop: true }
);

const STYLE_COLUMN = { padding: "4px 0 0" } as const;
const STYLE_FULL_WIDTH = { width: "100%" } as const;
const STYLE_FLEX_1 = { flex: 1 } as const;
// --- Памятка: плавающее перетаскиваемое окно ---

interface MemoPos {
    x: number;
    y: number;
}

const MEMO_POS_KEY = "vc-supportka-memo-pos";
const MEMO_SIZE_KEY = "vc-supportka-memo-size";

const DEFAULT_MEMO_SIZE = { width: 640, height: 540 };

const MEMO_ICON_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

const CLOSE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const PANEL_LEFT_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="18" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/></svg>';

const SHIELD_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>';

const CHEVRONS_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';

const CHEVRON_DOWN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

const CHEVRON_RIGHT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

const CHECK_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const INLINE_RE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|~~([^~]+)~~/g;

const HOISTED_BULLET_RE = /^\*\*([^*]+)\*\*/;
const HOISTED_NUM_RE = /^(\d+)\.\s+(.*)$/;

function renderInline(text: string): JSX.Element {
    const parts: JSX.Element[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(text))) {
        if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
        const [full, code, linkText, linkUrl, bold, italic, underline, strike] = m;
        if (code !== undefined) {
            parts.push(<code key={key++}>{code}</code>);
        } else if (linkText !== undefined) {
            parts.push(<a key={key++} href={linkUrl} target="_blank" rel="noreferrer noopener">{renderInline(linkText)}</a>);
        } else if (bold !== undefined) {
            parts.push(<strong key={key++}>{renderInline(bold)}</strong>);
        } else if (italic !== undefined) {
            parts.push(<em key={key++}>{renderInline(italic)}</em>);
        } else if (underline !== undefined) {
            parts.push(<u key={key++}>{renderInline(underline)}</u>);
        } else if (strike !== undefined) {
            parts.push(<s key={key++}>{renderInline(strike)}</s>);
        }
        last = m.index + full.length;
    }
    if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
    return <>{parts}</>;
}

interface MemoSectionNode {
    level: number;
    title: string;
    items: Array<MemoSectionNode | string[]>;
}

function parseMemo(content: string): Array<MemoSectionNode | string[]> {
    const root: Array<MemoSectionNode | string[]> = [];
    const stack: MemoSectionNode[] = [];
    let buffer: string[] = [];

    const flush = () => {
        if (!buffer.length) return;
        const target = stack.length ? stack[stack.length - 1].items : root;
        target.push(buffer);
        buffer = [];
    };

    for (const raw of content.split("\n")) {
        const line = raw.replace(/\r$/, "");
        const match = line.match(/^(#{2,3})\s+(.*)$/);
        if (match) {
            flush();
            const level = match[1].length;
            const node: MemoSectionNode = { level, title: match[2], items: [] };
            while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
            const target = stack.length ? stack[stack.length - 1].items : root;
            target.push(node);
            stack.push(node);
        } else {
            buffer.push(line);
        }
    }
    flush();
    return root;
}

function renderMemoLines(lines: string[]): JSX.Element[] {
    const nodes: JSX.Element[] = [];
    lines.forEach((raw, i) => {
        const line = raw.replace(/\r$/, "");
        if (!line.trim()) {
            nodes.push(<div key={i} className={cl("memo-gap")} />);
            return;
        }
        if (line.startsWith("##### ")) {
            nodes.push(<h6 key={i} className={cl("memo-h6")}>{renderInline(line.slice(6))}</h6>);
            return;
        }
        if (line.startsWith("#### ")) {
            nodes.push(<h5 key={i} className={cl("memo-h5")}>{renderInline(line.slice(5))}</h5>);
            return;
        }
        if (line.startsWith("### ")) {
            nodes.push(<h4 key={i} className={cl("memo-h4")}>{renderInline(line.slice(4))}</h4>);
            return;
        }
        if (line.startsWith("## ")) {
            nodes.push(<h3 key={i} className={cl("memo-h3")}>{renderInline(line.slice(3))}</h3>);
            return;
        }
        if (line.startsWith("# ")) {
            nodes.push(<h2 key={i} className={cl("memo-h2")}>{renderInline(line.slice(2))}</h2>);
            return;
        }
        if (line.startsWith("- ")) {
            const content = line.slice(2);
            const bold = content.match(HOISTED_BULLET_RE);
            const symbol = bold?.[1];
            const img = symbol ? getSymbolImage(symbol) : undefined;
            nodes.push(
                <div key={i}>
                    <div className={cl("memo-li")}><span className={cl("memo-bullet")}>•</span>{renderInline(content)}</div>
                    {img && <img className={cl("memo-symbol-img")} src={img} alt={symbol ?? ""} loading="lazy" />}
                </div>
            );
            return;
        }
        const num = line.match(HOISTED_NUM_RE);
        if (num) {
            nodes.push(<div key={i} className={cl("memo-li")}><span className={cl("memo-bullet")}>{num[1]}.</span>{renderInline(num[2])}</div>);
            return;
        }
        if (line.startsWith("> ")) {
            nodes.push(<div key={i} className={cl("memo-note")}>{renderInline(line.slice(2))}</div>);
            return;
        }
        if (line.trim() === "---") {
            nodes.push(<hr key={i} className={cl("memo-hr")} />);
            return;
        }
        nodes.push(<p key={i} className={cl("memo-p")}>{renderInline(line)}</p>);
    });
    return nodes;
}

function renderMemoItems(items: Array<MemoSectionNode | string[]>, baseKey: string, collapsed: Set<number>, toggle: (id: number) => void): JSX.Element[] {
    const nodes: JSX.Element[] = [];
    items.forEach((item, i) => {
        const id = baseKey ? baseKey.charCodeAt(0) * 31 + i : i;
        if (Array.isArray(item)) {
            nodes.push(<div key={`${baseKey}-t${i}`}>{renderMemoLines(item)}</div>);
        } else if (item.level === 2) {
            const isOpen = !collapsed.has(id);
            nodes.push(
                <div key={`${baseKey}-s${i}`} className={cl("memo-section")}>
                    <button
                        className={cl("memo-section-header")}
                        onClick={() => toggle(id)}
                    >
                        <span
                            className={cl("memo-section-chevron", isOpen ? "open" : "")}
                            dangerouslySetInnerHTML={{ __html: isOpen ? CHEVRON_DOWN_SVG : CHEVRON_RIGHT_SVG }}
                        />
                        {renderInline(item.title)}
                    </button>
                    {isOpen && (
                        <div className={cl("memo-section-body")}>
                            {renderMemoItems(item.items, `${baseKey}-s${i}`, collapsed, toggle)}
                        </div>
                    )}
                </div>
            );
        } else {
            const Tag = "h4";
            const styleClass = cl("memo-h3");
            nodes.push(
                <div key={`${baseKey}-s${i}`} className={cl("memo-sec")}>
                    <Tag className={styleClass}>{renderInline(item.title)}</Tag>
                    {renderMemoItems(item.items, `${baseKey}-s${i}`, collapsed, toggle)}
                </div>
            );
        }
    });
    return nodes;
}

function collectLevel2Ids(items: Array<MemoSectionNode | string[]>, baseKey: string): number[] {
    const ids: number[] = [];
    items.forEach((item, i) => {
        const id = baseKey ? baseKey.charCodeAt(0) * 31 + i : i;
        if (!Array.isArray(item) && item.level === 2) {
            ids.push(id);
        }
    });
    return ids;
}

function MemoBody({ content }: { content: string }) {
    const parsed = useMemo(() => parseMemo(content), [content]);
    const [collapsed, setCollapsed] = useState<Set<number>>(() => {
        const ids = collectLevel2Ids(parsed, "memo");
        return new Set(ids);
    });
    const toggle = useCallback((id: number) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const nodes = useMemo(() => renderMemoItems(parsed, "memo", collapsed, toggle), [parsed, collapsed, toggle]);
    return <>{nodes}</>;
}

interface MemoDocOption {
    id: string;
    label: string;
    subtitle?: string;
    icon: string;
}

const MEMO_DOCS: MemoDocOption[] = [
    { id: "support", label: "Саппорт", subtitle: "Тикеты и ответы на вопросы", icon: PANEL_LEFT_ICON_SVG },
    { id: "moderation", label: "Модерация", subtitle: "Правила и наказания", icon: SHIELD_ICON_SVG }
];

// Приводим CSS-переменную темы к непрозрачному цвету, чтобы выпадающие элементы
// читались даже на полупрозрачных темах.
let opaqueProbe: HTMLDivElement | null = null;
const opaqueBgCache = new Map<string, string>();

function opaqueBg(variable: string): string {
    try {
        const v = getComputedStyle(document.body).getPropertyValue(variable).trim();
        if (!v) return "#2b2d31";
        const cached = opaqueBgCache.get(v);
        if (cached) return cached;
        if (!opaqueProbe) {
            opaqueProbe = document.createElement("div");
            opaqueProbe.style.cssText = "position:fixed;left:-9999px;top:0;pointer-events:none;visibility:hidden;";
            document.body.appendChild(opaqueProbe);
        }
        opaqueProbe.style.background = v;
        const computed = getComputedStyle(opaqueProbe).backgroundColor;
        let result = v;
        const m = computed.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/i);
        if (m) {
            const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
            if (Number.isFinite(alpha) && alpha > 0) {
                result = `rgb(${Math.round(Number(m[1]))}, ${Math.round(Number(m[2]))}, ${Math.round(Number(m[3]))})`;
            } else {
                result = "#2b2d31";
            }
        }
        opaqueBgCache.set(v, result);
        return result;
    } catch {
        return "#2b2d31";
    }
}

function MemoSelect({ options, value, onChange }: {
    options: MemoDocOption[];
    value: string;
    onChange: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: globalThis.PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const selected = options.find(o => o.id === value) ?? options[0];

    return (
        <div ref={ref} className={cl("memo-select")}>
            <button
                type="button"
                className={cl("memo-select-trigger")}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            >
                <span className={cl("memo-select-icon")} dangerouslySetInnerHTML={{ __html: selected.icon }} />
                <span className={cl("memo-select-label")}>{selected.label}</span>
                <span className={cl("memo-select-chevrons")} dangerouslySetInnerHTML={{ __html: CHEVRONS_ICON_SVG }} />
            </button>
            {open && (
                <div className={cl("memo-select-menu")} style={{ backgroundColor: opaqueBg("--background-secondary"), opacity: 1 }} role="listbox" aria-label="Памятка">
                    {options.map(opt => {
                        const active = opt.id === selected.id;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                role="option"
                                aria-selected={active}
                                className={cl("memo-select-option", active ? "active" : "")}
                                onClick={() => {
                                    onChange(opt.id);
                                    setOpen(false);
                                }}
                            >
                                <span className={cl("memo-select-option-icon")} dangerouslySetInnerHTML={{ __html: opt.icon }} />
                                <span className={cl("memo-select-option-text")}>
                                    <span className={cl("memo-select-option-label")}>{opt.label}</span>
                                    {opt.subtitle && <span className={cl("memo-select-option-sub")}>{opt.subtitle}</span>}
                                </span>
                                {active && <span className={cl("memo-select-check")} dangerouslySetInnerHTML={{ __html: CHECK_ICON_SVG }} />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function parseMemoColor(c: string): [number, number, number] | null {
    const v = c.trim();
    if (!v) return null;
    if (v.startsWith("#")) {
        let h = v.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
        const n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    if (v.startsWith("rgb")) {
        const m = v.match(/[\d.]+/g);
        if (!m || m.length < 3) return null;
        return [Math.min(255, Number(m[0])), Math.min(255, Number(m[1])), Math.min(255, Number(m[2]))];
    }
    return null;
}

function memoLuminance([r, g, b]: [number, number, number]): number {
    const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function memoContrast(a: [number, number, number], b: [number, number, number]): number {
    const l1 = memoLuminance(a);
    const l2 = memoLuminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const MEMO_FALLBACK_COLORS = {
    dark: {
        text: "#ffffff",
        header: "#ffffff",
        muted: "#a9adb4",
        interactive: "#d4d7dc",
        interactiveMuted: "#949ba4",
        link: "#00a8fc",
    },
    light: {
        text: "#000000",
        header: "#000000",
        muted: "#6b6f78",
        interactive: "#4e5058",
        interactiveMuted: "#80848e",
        link: "#005bd6",
    },
} as const;

type MemoColorKey = keyof typeof MEMO_FALLBACK_COLORS.dark;

function applyMemoTheme(win: HTMLElement) {
    const cs = getComputedStyle(win);
    const bgColor =
        parseMemoColor(cs.getPropertyValue("--background-tertiary").trim()) ??
        parseMemoColor(cs.getPropertyValue("--background-secondary").trim()) ??
        [31, 31, 34] as [number, number, number];
    const fallback = memoLuminance(bgColor) > 0.5 ? MEMO_FALLBACK_COLORS.light : MEMO_FALLBACK_COLORS.dark;
    const setVar = (name: string, value: string) => {
        if (win.style.getPropertyValue(name) !== value) win.style.setProperty(name, value);
    };
    setVar("--vc-supportka-memo-bg", opaqueBg("--background-tertiary"));
    setVar("--vc-supportka-memo-bg-secondary", opaqueBg("--background-secondary"));
    setVar("--vc-supportka-memo-bg-modifier", opaqueBg("--background-modifier-accent"));
    setVar("--vc-supportka-memo-border", opaqueBg("--brand-experiment"));
    const checks: Array<[string, string, MemoColorKey]> = [
        ["--text-normal", "--vc-supportka-memo-text", "text"],
        ["--header-primary", "--vc-supportka-memo-header", "header"],
        ["--text-muted", "--vc-supportka-memo-text-muted", "muted"],
        ["--interactive-normal", "--vc-supportka-memo-interactive", "interactive"],
        ["--interactive-muted", "--vc-supportka-memo-interactive-muted", "interactiveMuted"],
        ["--text-link", "--vc-supportka-memo-link", "link"],
    ];
    for (const [srcVar, dstVar, key] of checks) {
        const col = parseMemoColor(cs.getPropertyValue(srcVar).trim());
        setVar(dstVar, col && memoContrast(col, bgColor) >= 3.5 ? `var(${srcVar})` : fallback[key]);
    }
}

function MemoWindow({ onClose, initialPos, initialSize }: { onClose: () => void; initialPos: MemoPos; initialSize: { width: number; height: number; }; }) {
    const [pos, setPos] = useState<MemoPos>(initialPos);
    const posRef = useRef(initialPos);
    const [size, setSize] = useState(initialSize);
    const sizeRef = useRef(initialSize);
    const [closing, setClosing] = useState(false);
    const closeTimer = useRef<number | null>(null);
    const drag = useRef<{ sx: number; sy: number; bx: number; by: number; } | null>(null);
    const resize = useRef<{ sx: number; sy: number; sw: number; sh: number; dir: string; } | null>(null);
    const winRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const win = winRef.current;
        if (!win) return;
        applyMemoTheme(win);
        let timer: number | null = null;
        const schedule = () => {
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => applyMemoTheme(win), 150);
        };
        const mo = new MutationObserver(schedule);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
        if (document.head) mo.observe(document.head, { childList: true });
        return () => {
            mo.disconnect();
            if (timer !== null) window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        posRef.current = pos;
    }, [pos]);

    useEffect(() => {
        sizeRef.current = size;
    }, [size]);

    useEffect(() => () => {
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
    }, []);

    const interaction = useRef<(() => void) | null>(null);

    useEffect(() => {
        const cancel = () => interaction.current?.();
        window.addEventListener("blur", cancel);
        return () => {
            window.removeEventListener("blur", cancel);
            cancel();
        };
    }, []);

    const close = useCallback(() => {
        if (closing) return;
        setClosing(true);
        closeTimer.current = window.setTimeout(() => onClose(), 190);
    }, [closing, onClose]);

    const onHeaderDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        const el = winRef.current;
        const target = e.currentTarget;
        if (!el) return;
        drag.current = { sx: e.clientX, sy: e.clientY, bx: posRef.current.x, by: posRef.current.y };
        target.setPointerCapture(e.pointerId);

        const onMove = (ev: PointerEvent) => {
            const d = drag.current;
            if (!d || !el) return;
            const w = sizeRef.current.width;
            const h = sizeRef.current.height;
            const x = Math.max(8, Math.min(window.innerWidth - w - 8, d.bx + ev.clientX - d.sx));
            const y = Math.max(48, Math.min(window.innerHeight - h - 8, d.by + ev.clientY - d.sy));
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        };
        const cleanup = () => {
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            target.removeEventListener("pointercancel", onUp);
            interaction.current = null;
        };
        const onUp = () => {
            const d = drag.current;
            if (d && el) {
                const x = parseFloat(el.style.left);
                const y = parseFloat(el.style.top);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    const p = { x, y };
                    posRef.current = p;
                    setPos(p);
                    void DataStore.set(MEMO_POS_KEY, p);
                }
            }
            cleanup();
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
        interaction.current = cleanup;
    };

    const onResizeStart = (dir: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = winRef.current;
        const target = e.currentTarget;
        if (!el) return;
        resize.current = { sx: e.clientX, sy: e.clientY, sw: sizeRef.current.width, sh: sizeRef.current.height, dir };
        target.setPointerCapture(e.pointerId);

        const onMove = (ev: PointerEvent) => {
            const r = resize.current;
            if (!r || !el) return;
            const dx = ev.clientX - r.sx;
            const dy = ev.clientY - r.sy;
            let width = r.sw;
            let height = r.sh;
            if (r.dir.includes("e")) width = r.sw + dx;
            if (r.dir.includes("s")) height = r.sh + dy;
            width = Math.max(360, width);
            height = Math.max(200, height);
            width = Math.min(window.innerWidth - posRef.current.x - 8, width);
            height = Math.min(window.innerHeight - posRef.current.y - 8, height);
            el.style.width = `${width}px`;
            el.style.height = `${height}px`;
        };
        const cleanup = () => {
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            target.removeEventListener("pointercancel", onUp);
            resize.current = null;
            interaction.current = null;
        };
        const onUp = () => {
            const r = resize.current;
            if (r && el) {
                const w = parseFloat(el.style.width);
                const h = parseFloat(el.style.height);
                if (Number.isFinite(w) && Number.isFinite(h)) {
                    const s = { width: w, height: h };
                    sizeRef.current = s;
                    setSize(s);
                    void DataStore.set(MEMO_SIZE_KEY, s);
                }
            }
            cleanup();
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
        interaction.current = cleanup;
    };

    const [memoId, setMemoId] = useState<string>("support");
    const content = memoId === "moderation"
        ? settings.store.memoContentModeration || DEFAULT_MODERATION_MEMO
        : settings.store.memoContent || DEFAULT_MEMO;

    return (
        <div ref={winRef} className={cl("memo-window", closing ? "closing" : "")} style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}>
            <div className={cl("memo-header")} onPointerDown={onHeaderDown}>
                <button className={cl("memo-close")} title="Закрыть" aria-label="Закрыть" onClick={close}>
                    <span dangerouslySetInnerHTML={{ __html: CLOSE_ICON_SVG }} />
                </button>
                <div className={cl("memo-header-main")}>
                    <span className={cl("memo-title")}>Памятка</span>
                    <span className={cl("memo-version")}>{MEMO_VERSION}</span>
                </div>
                <div className={cl("memo-header-select")} onPointerDown={e => e.stopPropagation()}>
                    <MemoSelect options={MEMO_DOCS} value={memoId} onChange={setMemoId} />
                </div>
            </div>
            <div className={cl("memo-body")}>
                <div key={memoId} className={cl("memo-content")}>
                    <MemoBody content={content} />
                </div>
            </div>
            <div className={cl("memo-resize-e")} onPointerDown={onResizeStart("e")} />
            <div className={cl("memo-resize-s")} onPointerDown={onResizeStart("s")} />
            <div className={cl("memo-resize-se")} onPointerDown={onResizeStart("se")} />
        </div>
    );
}

let memoRoot: Root | null = null;
let memoContainer: HTMLDivElement | null = null;

async function openMemoWindow() {
    if (memoRoot) return;
    const [p, s] = await Promise.all([
        DataStore.get<MemoPos>(MEMO_POS_KEY),
        DataStore.get<typeof DEFAULT_MEMO_SIZE>(MEMO_SIZE_KEY)
    ]);
    if (memoRoot) return;
    const w = s && Number.isFinite(s.width)
        ? Math.max(360, Math.min(window.innerWidth - 24, s.width))
        : DEFAULT_MEMO_SIZE.width;
    const h = s && Number.isFinite(s.height)
        ? Math.max(200, Math.min(window.innerHeight - 72, s.height))
        : DEFAULT_MEMO_SIZE.height;
    const x = p && Number.isFinite(p.x)
        ? Math.max(8, Math.min(window.innerWidth - w - 8, p.x))
        : 24;
    const y = p && Number.isFinite(p.y)
        ? Math.max(48, Math.min(window.innerHeight - h - 8, p.y))
        : 110;
    memoContainer = document.createElement("div");
    document.body.appendChild(memoContainer);
    memoRoot = createRoot(memoContainer);
    memoRoot.render(
        <ErrorBoundary>
            <MemoWindow onClose={closeMemoWindow} initialPos={{ x, y }} initialSize={{ width: w, height: h }} />
        </ErrorBoundary>,
    );
}

function closeMemoWindow() {
    memoRoot?.unmount();
    memoRoot = null;
    memoContainer?.remove();
    memoContainer = null;
}

// --- Памятка: кнопка в верхней панели Discord (между «Почтой» и «Помощью») ---

const MEMO_BUTTON_CLASS = cl("titlebar-btn");

const HELP_LABELS = new Set(["Помощь", "Help", "Hilfe", "Aide", "Ayuda", "Aiuto", "Pomoc", "Hulp", "Справка", "Допомога"]);
const INBOX_LABELS = new Set(["Почта", "Inbox", "Posteingang", "Boîte de réception", "Bandeja de entrada", "Posta in arrivo", "Skrzynka odbiorcza", "Postvak", "Скринька"]);

let memoObserver: MutationObserver | null = null;
let memoTitleButton: HTMLButtonElement | null = null;
let memoHelpBtn: HTMLElement | null = null;
let memoInboxBtn: HTMLElement | null = null;

function findLabeledButton(labels: Set<string>): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>("[aria-label], [title]")) {
        const value = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "").trim();
        if (value && labels.has(value)) return el;
    }
    return null;
}

function cachedLabeledButton(labels: Set<string>, cached: HTMLElement | null): HTMLElement | null {
    return cached?.isConnected ? cached : findLabeledButton(labels);
}

function ensureMemoButton() {
    if (memoTitleButton?.isConnected) return;
    if (!settings.store.showMemoButton) return;
    memoHelpBtn = cachedLabeledButton(HELP_LABELS, memoHelpBtn);
    memoInboxBtn = cachedLabeledButton(INBOX_LABELS, memoInboxBtn);
    const help = memoHelpBtn;
    const inbox = memoInboxBtn;
    const anchor = help ?? inbox;
    if (!anchor?.parentElement) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = MEMO_BUTTON_CLASS;
    btn.title = "Памятка";
    btn.setAttribute("aria-label", "Памятка");
    btn.innerHTML = MEMO_ICON_SVG;
    btn.style.cssText = "display:flex;align-items:center;justify-content:center;padding:0;margin:0;border:none;border-radius:4px;background:transparent;color:var(--interactive-normal);cursor:pointer;line-height:0;-webkit-app-region:no-drag;";
    const btnSvg = btn.querySelector("svg");
    if (btnSvg) btnSvg.style.cssText = "width:24px;height:24px;display:block;color:var(--interactive-normal);";
    btn.addEventListener("click", () => {
        if (memoRoot) {
            closeMemoWindow();
        } else {
            openMemoWindow();
        }
    });
    // Порядок: Почта -> Памятка -> Помощь. Вставляем сразу после «Почты» (если найдена),
    // иначе — перед «Помощью».
    if (inbox?.parentElement) {
        inbox.parentElement.insertBefore(btn, inbox.nextSibling);
    } else {
        anchor.parentElement.insertBefore(btn, anchor);
    }
    memoTitleButton = btn;
    requestAnimationFrame(() => placeMemoButtonBetween(btn, help, inbox));
}

// Подгоняем кнопку «Памятка» под размер и положение соседних кнопок («Почта»/«Помощь»),
// чтобы все три стояли ровно в одну линию.
function placeMemoButtonBetween(btn: HTMLButtonElement, help: HTMLElement | null, inbox: HTMLElement | null) {
    if (!btn?.isConnected) return;
    const ref = inbox?.isConnected ? inbox : (help?.isConnected ? help : null);
    const other = help?.isConnected ? help : (inbox?.isConnected ? inbox : null);
    if (!ref || !other || other === ref) return;

    const br = btn.getBoundingClientRect();
    const rr = ref.getBoundingClientRect();
    const or = other.getBoundingClientRect();
    const flows = br.right <= or.left + 2 && br.left >= rr.right - 2;

    // Цвет и размер иконки — как у соседней кнопки («Почта»/«Помощь»), чтобы не сливаться с фоном.
    try {
        const refSvg = ref.querySelector("svg");
        const svg = btn.querySelector("svg");
        if (refSvg) {
            const c = getComputedStyle(refSvg).color;
            if (c && c !== "transparent" && !c.includes("0, 0, 0, 0")) {
                btn.style.color = c;
                if (svg) svg.style.color = c;
            }
            const rs = refSvg.getBoundingClientRect();
            if (svg && rs.width > 0 && rs.height > 0) {
                svg.style.width = `${rs.width}px`;
                svg.style.height = `${rs.height}px`;
            }
        }
    } catch { }


    // Размер — точно как у соседней кнопки, чтобы стоять с ней вровень.
    btn.style.height = `${rr.height}px`;
    btn.style.width = `${rr.width}px`;
    btn.style.margin = "0";

    // Контейнер Discord не разложил кнопку по порядку — фиксируем её в зазоре между кнопками.
    const fixed = flows
        ? ""
        : (() => {
            const gap = or.left - rr.right;
            if (gap < rr.width + 8) return null;
            return `position:fixed;left:${rr.right + (gap - rr.width) / 2}px;top:${rr.top}px;z-index:100001;`;
        })();

    const prev = btn.getAttribute("data-memo-pos") ?? "";
    if (fixed === null) return;
    if (prev === fixed) return;
    btn.setAttribute("data-memo-pos", fixed);
    btn.style.position = "";
    btn.style.left = "";
    btn.style.top = "";
    btn.style.zIndex = "";
    if (fixed) {
        for (const part of fixed.split(";")) {
            if (!part) continue;
            const idx = part.indexOf(":");
            btn.style[part.slice(0, idx) as "position"] = part.slice(idx + 1);
        }
    }
}

const scheduleMemoButton = debounce(() => {
    ensureMemoButton();
}, 300);

function onMemoWindowResize() {
    if (!memoTitleButton?.isConnected) return;
    memoHelpBtn = cachedLabeledButton(HELP_LABELS, memoHelpBtn);
    memoInboxBtn = cachedLabeledButton(INBOX_LABELS, memoInboxBtn);
    placeMemoButtonBetween(memoTitleButton, memoHelpBtn, memoInboxBtn);
}

function startMemoButton() {
    ensureMemoButton();
    window.addEventListener("resize", onMemoWindowResize);
    memoObserver = new MutationObserver(scheduleMemoButton);
    memoObserver.observe(document.body, { childList: true, subtree: true });
}

function stopMemoButton() {
    window.removeEventListener("resize", onMemoWindowResize);
    memoObserver?.disconnect();
    memoObserver = null;
    memoTitleButton?.remove();
    memoTitleButton = null;
    memoHelpBtn = null;
    memoInboxBtn = null;
    closeMemoWindow();
}

export default definePlugin({
    name: "supportka",
    description: "Сапорта: реально крутая вещь для сапортов Lounge",
    searchTerms: ["сапортка", "мальчик", "девочка", "отказ", "мьют", "оверлей", "overlay"],
    tags: ["Voice", "Utility"],
    enabledByDefault: true,
    authors: [{
        name: "Brqden_",
        id: 502445992239562772n
    }],
    settings,

    start() {
        if (settings.store.rejectPresets === OLD_REJECT_PRESETS) {
            settings.store.rejectPresets = DEFAULT_REJECT_PRESETS;
        }
        const badMemo = (content: string | undefined) => Boolean(content && /[\u5350\u534D\u03DF\uA46D]/.test(content));
        if (badMemo(settings.store.memoContent) || badMemo(settings.store.memoContentModeration)) {
            if (badMemo(settings.store.memoContent)) settings.store.memoContent = DEFAULT_MEMO;
            if (badMemo(settings.store.memoContentModeration)) settings.store.memoContentModeration = DEFAULT_MODERATION_MEMO;
            showToast("Сапортка: памятка обновлена — убраны символы, вызывающие автобан", Toasts.Type.SUCCESS);
        }
        if (settings.store.memoContent && settings.store.memoContent.includes("## Ответы на часто задаваемые вопросы")) {
            settings.store.memoContent = DEFAULT_MEMO;
            showToast("Сапортка: памятка обновлена до новой структуры", Toasts.Type.SUCCESS);
        }
        if (settings.store.memoContent?.startsWith("## Основная информация")) {
            settings.store.memoContent = DEFAULT_MEMO;
            showToast("Сапортка: памятка обновлена — разделы: Чек-лист, Тикеты, Символика", Toasts.Type.SUCCESS);
        }
        startPolling();
        startMemoButton();
        startOverlay(buildOverlayOptions());
    },
    stop() {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = undefined;
        stopMemoButton();
        stopOverlay();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            handleRelayMessage(message);
        }
    },

    patches: [
        {
            // Same find as ShowConnections
            find: '"UserProfilePopout");',
            replacement: {
                match: /userId:\i\.id,guild:\i\}\)(?=])/,
                replace: "$&,$self.SupportkaButtons(arguments[0])"
            }
        }
    ],

    SupportkaButtons
});
