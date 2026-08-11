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
import { fetchUserProfile } from "@utils/discord";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Message, RenderModalProps, User } from "@vencord/discord-types";
import { createRoot, Forms, GuildMemberStore, Modal, openModal, PresenceStore, RestAPI, SelectedGuildStore, showToast, TextInput, Toasts, UserProfileStore, UserStore, useEffect, useRef, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";
import { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { Root } from "react-dom/client";

import { runCheck } from "./check";
import { DEFAULT_MEMO } from "./memo";

const DEFAULT_BOY_CHANNEL = "852418390618275891";
const DEFAULT_GIRL_CHANNEL = "853603250443780116";
const DEFAULT_REJECT_CHANNEL = "852418435031498752";

const COMMAND_TYPE = "vc-supportka";

const ACCEPTED_KEY = "vc-supportka-status";
const CHANNEL_CACHE_KEY = "vc-supportka-channels";
const LAST_PROCESSED_KEY = "vc-supportka-last-processed";

interface StatusEntry {
    name?: string;
    status: "accepted" | "rejected";
    action?: string;
    reason?: string;
    time: number;
}

async function setStatus(userId: string, entry: StatusEntry) {
    const map = (await DataStore.get<Record<string, StatusEntry>>(ACCEPTED_KEY)) ?? {};
    map[userId] = entry;
    await DataStore.set(ACCEPTED_KEY, map);
}

async function clearStatus(userId: string) {
    const map = (await DataStore.get<Record<string, StatusEntry>>(ACCEPTED_KEY)) ?? {};
    delete map[userId];
    await DataStore.set(ACCEPTED_KEY, map);
}

const cl = classNameFactory("vc-supportka-");

const settings = definePluginSettings({
    relayChannelId: {
        type: OptionType.STRING,
        description: "Канал, в который отправляются команды (релей-канал)",
        default: "1535964031276294235"
    },
    relayGuildId: {
        type: OptionType.STRING,
        displayName: "Сервер релея",
        description: "Сервер, в котором создаются каналы «мальчик/девочка/отказ», если их не нашли автоматически",
        default: "1535963962053632120"
    },
    boyChannelId: {
        type: OptionType.STRING,
        displayName: "Канал «Мальчик»",
        description: "Канал, куда отправляется сообщение при нажатии Мальчик. Если канала нет — создастся автоматически.",
        default: DEFAULT_BOY_CHANNEL
    },
    girlChannelId: {
        type: OptionType.STRING,
        displayName: "Канал «Девочка»",
        description: "Канал, куда отправляется сообщение при нажатии Девочка. Если канала нет — создастся автоматически.",
        default: DEFAULT_GIRL_CHANNEL
    },
    rejectChannelId: {
        type: OptionType.STRING,
        displayName: "Канал «Отказ»",
        description: "Канал, куда отправляется сообщение при нажатии Отказ. Если канала нет — создастся автоматически.",
        default: DEFAULT_REJECT_CHANNEL
    },
    controllerId: {
        type: OptionType.STRING,
        description: "ID друга, команды которого нужно выполнять",
        default: "611522379776000001"
    },
    sendCommands: {
        type: OptionType.BOOLEAN,
        displayName: "Отправлять команды",
        description: "Отправлять команды в релей-канал вместо выполнения напрямую. Включи на аккаунте друга.",
        default: false
    },
    executeCommands: {
        type: OptionType.BOOLEAN,
        displayName: "Выполнять команды",
        description: "Слушать релей-канал и выполнять команды от друга. Включи на своём аккаунте.",
        default: false
    },
    checkProfile: {
        type: OptionType.BOOLEAN,
        displayName: "Проверять профиль",
        description: "Автоматически проверять профиль на нарушения по чек-листу и показывать результат в попапе.",
        default: true
    },
    markAccepted: {
        type: OptionType.BOOLEAN,
        displayName: "Отмечать принятых",
        description: "Автоматически помечать пользователя как принятого при нажатии Мальчик/Девочка. Также можно отметить вручную в профиле.",
        default: true
    },
    rejectPresets: {
        type: OptionType.STRING,
        displayName: "Пресеты причин отказа",
        description: "Быстрые причины в окне «Отказ», разделяются ;",
        default: "АртёмВавилов;Запрещённая символика;Пропаганда наркотиков;Оскорбления;Ссылки без спойлера;Перезаходит в прихожую;Возраст"
    },
    extraBannedWords: {
        type: OptionType.STRING,
        displayName: "Доп. запрещённые слова",
        description: "Слова/фразы, которые считать нарушением (красный). Разделяются ;",
        default: ""
    },
    extraAllowedLinks: {
        type: OptionType.STRING,
        displayName: "Разрешённые ссылки",
        description: "Доп. домены/ключевые слова ссылок, которые не считаются нарушением. Разделяются ;",
        default: ""
    },
    extraBannedLinks: {
        type: OptionType.STRING,
        displayName: "Ссылки для удаления",
        description: "Доп. домены ссылок, которые нужно убрать полностью (красный). Разделяются ;",
        default: ""
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
            url: `/guilds/${settings.store.relayGuildId}/channels`,
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
        await sendRawMessage(settings.store.relayChannelId, buildCommand(action, userId, guildId, reason));
        showToast("Команда отправлена Brqden_", Toasts.Type.SUCCESS);
    } catch {
        showToast("Не удалось отправить команду (нет доступа к релей-каналу?)", Toasts.Type.FAILURE);
    }
}

function executeCommand(command: SupportCommand) {
    switch (command.action) {
        case "boy":
            if (settings.store.markAccepted) void setStatus(command.user, { status: "accepted", action: "boy", time: Date.now() });
            void sendBoy(command.user);
            break;
        case "girl":
            if (settings.store.markAccepted) void setStatus(command.user, { status: "accepted", action: "girl", time: Date.now() });
            void sendGirl(command.user);
            break;
        case "mute":
        case "unmute":
            if (command.guild) setServerMute(command.guild, command.user, command.action === "mute");
            break;
        case "reject":
            if (command.reason) {
                if (settings.store.markAccepted) void setStatus(command.user, { status: "rejected", reason: command.reason, time: Date.now() });
                void sendReject(command.user, command.reason);
            }
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
    if (message.channel_id !== settings.store.relayChannelId) return;
    if (!message.content?.startsWith(`{"type":"${COMMAND_TYPE}"`)) return;
    if (isAlreadyProcessed(message.channel_id, message.id)) return;
    markProcessed(message.channel_id, message.id);

    if (message.author?.id === UserStore.getCurrentUser().id) return;

    if (!settings.store.executeCommands) {
        showToast("Сапортка: получена команда, но «Выполнять команды» выключено", Toasts.Type.FAILURE);
        return;
    }
    if (message.author?.id !== settings.store.controllerId) {
        showToast(`Сапортка: команда от неизвестного (${message.author?.id}), ожидался ${settings.store.controllerId}`, Toasts.Type.FAILURE);
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

async function pollRelay() {
    if (!settings.store.executeCommands) return;
    try {
        const { body } = await RestAPI.get({
            url: `/channels/${settings.store.relayChannelId}/messages?limit=10`
        });
        for (const message of body) handleRelayMessage(message);
    } catch {
        // релей-канал недоступен — ничего не делаем
    }
}

function startPolling() {
    void loadLastProcessed();
    void pollRelay();
    pollTimer = window.setInterval(() => void pollRelay(), 5000);
}

function openRejectModal(userId: string, guildId: string, controller: boolean, name?: string) {
    openModal(props => (
        <RejectModal userId={userId} guildId={guildId} controller={controller} name={name} modalProps={props} />
    ));
}

function RejectModal({ modalProps, userId, guildId, controller, name }: { modalProps: RenderModalProps; userId: string; guildId: string; controller: boolean; name?: string; }) {
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
        if (settings.store.markAccepted) void setStatus(userId, { status: "rejected", reason: trimmed, name, time: Date.now() });
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
            if (settings.store.markAccepted) void setStatus(user.id, { status: "accepted", action: "boy", name: user.globalName ?? user.username, time: Date.now() });
            if (controller) {
                void sendCommand("boy", user.id, guildId);
            } else {
                void sendBoy(user.id);
            }
        };

        const onGirl = () => {
            if (settings.store.markAccepted) void setStatus(user.id, { status: "accepted", action: "girl", name: user.globalName ?? user.username, time: Date.now() });
            if (controller) {
                void sendCommand("girl", user.id, guildId);
            } else {
                void sendGirl(user.id);
            }
        };

        const onReject = () => {
            openRejectModal(user.id, guildId, controller, user.globalName ?? user.username);
        };

        return (
            <Flex flexDirection="column" gap={6} style={{ padding: "4px 0 0" }}>
                <Button
                    variant="secondary"
                    size="medium"
                    className={cl("mute")}
                    style={{ width: "100%" }}
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
                        style={{ flex: 1 }}
                        onClick={onBoy}
                    >
                        Мальчик
                    </Button>
                    <Button
                        variant="primary"
                        size="medium"
                        className={cl("girl")}
                        style={{ flex: 1 }}
                        onClick={onGirl}
                    >
                        Девочка
                    </Button>
                </Flex>
                <Button
                    variant="dangerSecondary"
                    size="medium"
                    style={{ width: "100%" }}
                    onClick={onReject}
                >
                    Отказ
                </Button>
            </Flex>
        );
    },
    { noop: true }
);

const SupportkaCheck = ErrorBoundary.wrap(
    (props: { user?: User; guildId?: string; }) => {
        const { user } = props;
        if (!user?.id || !settings.store.checkProfile) return null;

        const [statusVersion, setStatusVersion] = useState(0);
        const [statusMap] = useAwaiter(
            () => DataStore.get<Record<string, StatusEntry>>(ACCEPTED_KEY),
            { deps: [user.id, statusVersion], fallbackValue: null }
        );

        const [profile, , loading] = useAwaiter(
            () => user.id
                ? fetchUserProfile(user.id, props.guildId ? { guild_id: props.guildId } : undefined)
                : Promise.resolve(null),
            { deps: [user.id, props.guildId], fallbackValue: UserProfileStore.getUserProfile(user.id) ?? null }
        );

        const nick = useStateFromStores(
            [GuildMemberStore],
            () => props.guildId ? GuildMemberStore.getMember(props.guildId!, user.id)?.nick ?? null : null,
            [props.guildId, user.id]
        );

        const activities = useStateFromStores(
            [PresenceStore],
            () => PresenceStore.getActivities(user.id),
            [user.id]
        );

        const status = activities.find(a => a.type === 4)?.state;

        const s = settings.store;

        const violations = runCheck({
            nick,
            globalName: user.globalName,
            status,
            bio: profile?.bio,
            pronouns: profile?.pronouns
        }, {
            bannedWords: s.extraBannedWords.split(";").map(v => v.trim()).filter(Boolean),
            allowedLinks: s.extraAllowedLinks.split(";").map(v => v.trim()).filter(Boolean),
            bannedLinks: s.extraBannedLinks.split(";").map(v => v.trim()).filter(Boolean)
        });

        const statusEntry = statusMap?.[user.id];
        const isAccepted = statusEntry?.status === "accepted";
        const isRejected = statusEntry?.status === "rejected";

        const actionLabel = statusEntry?.action === "boy" ? "Мальчик"
            : statusEntry?.action === "girl" ? "Девочка" : null;

        const statusDate = statusEntry?.time
            ? new Date(statusEntry.time).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
            : null;

        const toggleStatus = async (entry?: StatusEntry) => {
            if (entry) {
                await clearStatus(user.id);
            } else {
                await setStatus(user.id, { status: "accepted", action: "manual", name: user.globalName ?? user.username, time: Date.now() });
            }
            setStatusVersion(v => v + 1);
        };

        const toggleRejected = async (entry?: StatusEntry) => {
            if (entry) {
                await clearStatus(user.id);
            } else {
                await setStatus(user.id, { status: "rejected", name: user.globalName ?? user.username, time: Date.now() });
            }
            setStatusVersion(v => v + 1);
        };

        return (
            <div className={cl("check")}>
                <Flex flexDirection="row" gap={6} style={{ marginBottom: 6 }}>
                    {isAccepted || isRejected ? (
                        <Button
                            variant={isAccepted ? "positive" : "dangerPrimary"}
                            size="small"
                            className={isAccepted ? cl("accepted") : cl("rejected")}
                            style={{ flex: 1 }}
                            onClick={() => void (isAccepted ? toggleStatus(statusEntry) : toggleRejected(statusEntry))}
                        >
                            {isAccepted
                                ? `Принят${actionLabel ? ` (${actionLabel})` : ""}${statusDate ? ` ${statusDate}` : ""} — снять`
                                : `Отклонён${statusDate ? ` ${statusDate}` : ""} — снять`}
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="secondary"
                                size="small"
                                className={cl("accept")}
                                style={{ flex: 1 }}
                                onClick={() => void toggleStatus()}
                            >
                                Принят
                            </Button>
                            <Button
                                variant="secondary"
                                size="small"
                                className={cl("reject")}
                                style={{ flex: 1 }}
                                onClick={() => void toggleRejected()}
                            >
                                Отклонён
                            </Button>
                        </>
                    )}
                </Flex>
                <Forms.FormTitle tag="h5" className={cl("check-title")}>Проверка профиля</Forms.FormTitle>
                {loading ? (
                    <span className={cl("check-loading")}>Проверка...</span>
                ) : violations.length === 0 ? (
                    <span className={cl("check-ok")}>Нарушений не найдено</span>
                ) : (
                    <div className={cl("check-list")}>
                        {violations.map((violation, i) => (
                            <div
                                key={i}
                                className={violation.severity === "error" ? cl("check-item-error") : cl("check-item-warn")}
                            >
                                <span className={cl("check-field")}>{violation.field}:</span> {violation.message}
                            </div>
                        ))}
                    </div>
                )}
                <Forms.FormText className={cl("check-note")}>
                    Аватар и копирование профиля автоматически не проверяются
                </Forms.FormText>
            </div>
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

const MEMO_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>';

const CLOSE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

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

function MemoBody({ content }: { content: string }) {
    const nodes: JSX.Element[] = [];
    content.split("\n").forEach((raw, i) => {
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
            nodes.push(<div key={i} className={cl("memo-li")}><span className={cl("memo-bullet")}>•</span>{renderInline(line.slice(2))}</div>);
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
    return <>{nodes}</>;
}

function MemoWindow({ onClose }: { onClose: () => void }) {
    const [pos, setPos] = useState<MemoPos>({ x: 24, y: 110 });
    const posRef = useRef(pos);
    const drag = useRef<{ sx: number; sy: number; bx: number; by: number; } | null>(null);
    const winRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        posRef.current = pos;
    }, [pos]);

    useEffect(() => {
        void DataStore.get<MemoPos>(MEMO_POS_KEY).then(p => {
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
            const w = winRef.current?.offsetWidth ?? 400;
            const h = winRef.current?.offsetHeight ?? 500;
            setPos({
                x: Math.max(8, Math.min(window.innerWidth - w - 8, p.x)),
                y: Math.max(48, Math.min(window.innerHeight - h - 8, p.y))
            });
        });
    }, []);

    const onHeaderDown = (e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        drag.current = { sx: e.clientX, sy: e.clientY, bx: posRef.current.x, by: posRef.current.y };
        const onMove = (ev: MouseEvent) => {
            if (!drag.current) return;
            const w = winRef.current?.offsetWidth ?? 400;
            const h = winRef.current?.offsetHeight ?? 500;
            setPos({
                x: Math.max(8, Math.min(window.innerWidth - w - 8, drag.current.bx + ev.clientX - drag.current.sx)),
                y: Math.max(48, Math.min(window.innerHeight - h - 8, drag.current.by + ev.clientY - drag.current.sy))
            });
        };
        const onUp = () => {
            if (drag.current) void DataStore.set(MEMO_POS_KEY, posRef.current);
            drag.current = null;
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    };

    const content = settings.store.memoContent || DEFAULT_MEMO;

    return (
        <div ref={winRef} className={cl("memo-window")} style={{ left: pos.x, top: pos.y }}>
            <div className={cl("memo-header")} onMouseDown={onHeaderDown}>
                <span className={cl("memo-title")}>
                    <span dangerouslySetInnerHTML={{ __html: MEMO_ICON_SVG }} />
                    Памятка саппорта
                </span>
                <button className={cl("memo-close")} title="Закрыть" aria-label="Закрыть" onClick={onClose}>
                    <span dangerouslySetInnerHTML={{ __html: CLOSE_ICON_SVG }} />
                </button>
            </div>
            <div className={cl("memo-body")}>
                <MemoBody content={content} />
            </div>
        </div>
    );
}

let memoRoot: Root | null = null;
let memoContainer: HTMLDivElement | null = null;

function openMemoWindow() {
    if (memoRoot) return;
    memoContainer = document.createElement("div");
    document.body.appendChild(memoContainer);
    memoRoot = createRoot(memoContainer);
    memoRoot.render(<MemoWindow onClose={closeMemoWindow} />);
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

function findLabeledButton(labels: Set<string>): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>("[aria-label], [title]")) {
        const value = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "").trim();
        if (value && labels.has(value)) return el;
    }
    return null;
}

function ensureMemoButton() {
    if (memoTitleButton?.isConnected) return;
    if (!settings.store.showMemoButton) return;
    const help = findLabeledButton(HELP_LABELS);
    const inbox = findLabeledButton(INBOX_LABELS);
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

// Если контейнер Discord не раскладывает вставленную кнопку по порядку (наложение на «Помощь»),
// вручную позиционируем её в зазор между «Почтой» и «Помощью».
function placeMemoButtonBetween(btn: HTMLButtonElement, help: HTMLElement | null, inbox: HTMLElement | null) {
    if (!btn.isConnected) return;
    if (!help?.isConnected || !inbox?.isConnected) return;
    const br = btn.getBoundingClientRect();
    const hr = help.getBoundingClientRect();
    const ir = inbox.getBoundingClientRect();
    const flows = br.right <= hr.left + 2 && br.left >= ir.right - 2;
    if (flows) {
        btn.style.position = "";
        btn.style.left = "";
        btn.style.top = "";
        btn.style.height = "";
        btn.style.margin = "";
        btn.style.zIndex = "";
        return;
    }
    const gap = hr.left - ir.right;
    if (gap < br.width + 8) return;
    btn.style.position = "fixed";
    btn.style.left = `${ir.right + (gap - br.width) / 2}px`;
    btn.style.top = `${ir.top}px`;
    btn.style.height = `${ir.height}px`;
    btn.style.margin = "0";
    btn.style.zIndex = "100001";
}

const scheduleMemoButton = debounce(() => {
    ensureMemoButton();
    if (memoTitleButton?.isConnected) {
        placeMemoButtonBetween(memoTitleButton, findLabeledButton(HELP_LABELS), findLabeledButton(INBOX_LABELS));
    }
}, 300);

function startMemoButton() {
    ensureMemoButton();
    memoObserver = new MutationObserver(scheduleMemoButton);
    memoObserver.observe(document.body, { childList: true, subtree: true });
}

function stopMemoButton() {
    memoObserver?.disconnect();
    memoObserver = null;
    memoTitleButton?.remove();
    memoTitleButton = null;
    closeMemoWindow();
}

export default definePlugin({
    name: "supportka",
    description: "Кнопки сапортки в профиле пользователя: Замутить/Размутить, Мальчик, Девочка и Отказ с причиной. Умеет управлять через друга по командам в релей-канале.",
    searchTerms: ["сапортка", "мальчик", "девочка", "отказ", "мьют"],
    tags: ["Voice", "Utility"],
    enabledByDefault: true,
    authors: [{
        name: "Brqden_",
        id: 502445992239562772n
    }],
    settings,

    start() {
        startPolling();
        startMemoButton();
    },
    stop() {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = undefined;
        stopMemoButton();
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
                replace: "$&,$self.SupportkaButtons(arguments[0]),$self.SupportkaCheck(arguments[0])"
            }
        }
    ],

    SupportkaButtons,
    SupportkaCheck
});
