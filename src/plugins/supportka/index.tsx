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
import definePlugin, { OptionType } from "@utils/types";
import { Message, RenderModalProps, User } from "@vencord/discord-types";
import { createRoot, Forms, Modal, openModal, RestAPI, SelectedGuildStore, showToast, TextInput, Toasts, useCallback, useEffect, useMemo, useRef, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";
import { JSX, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { Root } from "react-dom/client";

import { DEFAULT_MEMO } from "./memo";
import { OverlayOptions, OverlayRole, startOverlay, stopOverlay } from "./overlay";
import { getSymbolImage } from "./symbols";

const DEFAULT_BOY_CHANNEL = "852418390618275891";
const DEFAULT_GIRL_CHANNEL = "853603250443780116";
const DEFAULT_REJECT_CHANNEL = "852418435031498752";

const DEFAULT_RELAY_GUILD_ID = "1535963962053632120";
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
        displayName: "Значки ролей в оверлее (в разработке)",
        description: "В игровом оверлее Discord показывать у участников голосового канала метку их роли. Функция пока нестабильна и находится в разработке.",
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
        displayName: "Текст памятки",
        description: "Содержимое памятки. Формат строк: ## заголовок, ### подзаголовок, - пункт, 1. нумерованный пункт, > заметка, --- разделитель, **жирный**, `код`.",
        default: DEFAULT_MEMO
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
        roles: parseOverlayEntries(settings.store.overlayEntries)
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

function startPolling() {
    void loadLastProcessed();
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

    const presets = settings.store.rejectPresets
        .split(";")
        .map(p => p.trim())
        .filter(Boolean);

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
            <Flex flexDirection="column" gap={6} style={{ padding: "4px 0 0" }}>
                <Button
                    variant="secondary"
                    size="medium"
                    className={cl("mute")}
                    style={{ width: "100%", backgroundColor: "#3f4147", borderColor: "transparent", color: "#f2f3f5" }}
                    onClick={onMute}
                    disabled={!inVoice}
                >
                    {voiceState?.mute ? "Размутить" : "Замутить"}
                </Button>
                <Flex gap={6}>
                    <Button
                        variant="primary"
                        size="medium"
                        className={cl("boy")}
                        style={{ flex: 1, backgroundColor: "#3b82f6", borderColor: "transparent", color: "#fff" }}
                        onClick={onBoy}
                    >
                        Мальчик
                    </Button>
                    <Button
                        variant="primary"
                        size="medium"
                        className={cl("girl")}
                        style={{ flex: 1, backgroundColor: "#eb459e", borderColor: "transparent", color: "#fff" }}
                        onClick={onGirl}
                    >
                        Девочка
                    </Button>
                </Flex>
                <Button
                    variant="dangerSecondary"
                    size="medium"
                    className={cl("reject")}
                    style={{ width: "100%", backgroundColor: "#f23f43", borderColor: "transparent", color: "#fff" }}
                    onClick={onReject}
                >
                    Отказ
                </Button>
            </Flex>
        );
    },
    { noop: true }
);

// --- Памятка: плавающее перетаскиваемое окно ---

interface MemoPos {
    x: number;
    y: number;
}

const MEMO_POS_KEY = "vc-supportka-memo-pos";
const MEMO_SIZE_KEY = "vc-supportka-memo-size";

const DEFAULT_MEMO_SIZE = { width: 400, height: 520 };

const MEMO_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>';

const CLOSE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const CHEVRON_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

const INLINE_RE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|~~([^~]+)~~/g;

function renderInline(text: string): JSX.Element {
    const parts: JSX.Element[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    const re = new RegExp(INLINE_RE);
    while ((m = re.exec(text))) {
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
            const bold = content.match(/^\*\*([^*]+)\*\*/);
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
        const num = line.match(/^(\d+)\.\s+(.*)$/);
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

function MemoSection({ level, title, children }: { level: number; title: string; children: ReactNode }) {
    const [open, setOpen] = useState(true);
    return (
        <div className={cl("memo-section")}>
            <button
                className={cl("memo-section-header", `memo-section-header-${level}`)}
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            >
                <span className={cl("memo-section-chevron", open ? "open" : "")}>
                    <span dangerouslySetInnerHTML={{ __html: CHEVRON_ICON_SVG }} />
                </span>
                <span className={cl("memo-section-title")}>{renderInline(title)}</span>
            </button>
            <div className={cl("memo-section-collapse", open ? "open" : "closed")}>
                <div className={cl("memo-section-body")}>{children}</div>
            </div>
        </div>
    );
}

function renderMemoItems(items: Array<MemoSectionNode | string[]>, baseKey: string): JSX.Element[] {
    const nodes: JSX.Element[] = [];
    items.forEach((item, i) => {
        if (Array.isArray(item)) {
            nodes.push(<div key={`${baseKey}-t${i}`}>{renderMemoLines(item)}</div>);
        } else {
            nodes.push(
                <MemoSection key={`${baseKey}-s${i}`} level={item.level} title={item.title}>
                    {renderMemoItems(item.items, `${baseKey}-s${i}`)}
                </MemoSection>
            );
        }
    });
    return nodes;
}

function MemoBody({ content }: { content: string }) {
    const nodes = useMemo(() => renderMemoItems(parseMemo(content), "memo"), [content]);
    return <>{nodes}</>;
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
            drag.current = null;
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
            width = Math.max(300, width);
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

    const content = settings.store.memoContent || DEFAULT_MEMO;

    return (
        <div ref={winRef} className={cl("memo-window", closing ? "closing" : "")} style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}>
            <div className={cl("memo-header")} onPointerDown={onHeaderDown}>
                <span className={cl("memo-title")}>
                    <span dangerouslySetInnerHTML={{ __html: MEMO_ICON_SVG }} />
                    Памятка саппорта
                </span>
                <button className={cl("memo-close")} title="Закрыть" aria-label="Закрыть" onClick={close}>
                    <span dangerouslySetInnerHTML={{ __html: CLOSE_ICON_SVG }} />
                </button>
            </div>
            <div className={cl("memo-body")}>
                <MemoBody content={content} />
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
        ? Math.max(300, Math.min(window.innerWidth - 24, s.width))
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
        startPolling();
        startMemoButton();
        if (settings.store.overlayEnabled) startOverlay(buildOverlayOptions());
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
