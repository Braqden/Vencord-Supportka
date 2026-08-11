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
import { classNameFactory } from "@utils/css";
import { fetchUserProfile, sendMessage } from "@utils/discord";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Message, RenderModalProps, User } from "@vencord/discord-types";
import { Forms, GuildMemberStore, Modal, openModal, PresenceStore, RestAPI, SelectedGuildStore, showToast, TextInput, Toasts, UserProfileStore, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";
import { KeyboardEvent } from "react";

import { runCheck } from "./check";

const BOY_CHANNEL = "852418390618275891";
const GIRL_FIRST_CHANNEL = "853603250443780116";
const GIRL_SECOND_CHANNEL = "852418390618275891";
const REJECT_CHANNEL = "852418435031498752";

const COMMAND_TYPE = "vc-supportka";

const ACCEPTED_KEY = "vc-supportka-status";

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
    }
});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function setServerMute(guildId: string, userId: string, mute: boolean) {
    RestAPI.patch({
        url: `/guilds/${guildId}/members/${userId}`,
        body: { mute }
    })
        .then(() => showToast(mute ? "Пользователь замьючен" : "Пользователь размьючен", Toasts.Type.SUCCESS))
        .catch(() => showToast("Не удалось изменить мьют (нет прав или пользователь не в голосовом канале)", Toasts.Type.FAILURE));
}

function sendBoy(userId: string) {
    sendMessage(BOY_CHANNEL, { content: userId });
    showToast("Отправлено: Мальчик", Toasts.Type.SUCCESS);
}

async function sendGirl(userId: string) {
    await sendMessage(GIRL_FIRST_CHANNEL, { content: userId });
    await wait(250);
    await sendMessage(GIRL_SECOND_CHANNEL, { content: userId });
    showToast("Отправлено: Девочка", Toasts.Type.SUCCESS);
}

function sendReject(userId: string, reason: string) {
    sendMessage(REJECT_CHANNEL, { content: `${userId} ${reason}` });
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
        await sendMessage(settings.store.relayChannelId, { content: buildCommand(action, userId, guildId, reason) });
        showToast("Команда отправлена Brqden_", Toasts.Type.SUCCESS);
    } catch {
        showToast("Не удалось отправить команду (нет доступа к релей-каналу?)", Toasts.Type.FAILURE);
    }
}

function executeCommand(command: SupportCommand) {
    switch (command.action) {
        case "boy":
            if (settings.store.markAccepted) void setStatus(command.user, { status: "accepted", action: "boy", time: Date.now() });
            sendBoy(command.user);
            break;
        case "girl":
            if (settings.store.markAccepted) void setStatus(command.user, { status: "accepted", action: "girl", time: Date.now() });
            sendGirl(command.user);
            break;
        case "mute":
            if (command.guild) setServerMute(command.guild, command.user, command.action === "mute");
            break;
        case "reject":
            if (command.reason) {
                if (settings.store.markAccepted) void setStatus(command.user, { status: "rejected", reason: command.reason, time: Date.now() });
                sendReject(command.user, command.reason);
            }
            break;
    }
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
            sendCommand("reject", userId, guildId, trimmed);
        } else {
            sendReject(userId, trimmed);
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
                sendCommand("boy", user.id, guildId);
            } else {
                sendBoy(user.id);
            }
        };

        const onGirl = () => {
            if (settings.store.markAccepted) void setStatus(user.id, { status: "accepted", action: "girl", name: user.globalName ?? user.username, time: Date.now() });
            if (controller) {
                sendCommand("girl", user.id, guildId);
            } else {
                sendGirl(user.id);
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

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            const isCommand = message.content?.startsWith(`{"type":"${COMMAND_TYPE}"`);
            if (message.channel_id !== settings.store.relayChannelId) return;
            if (!isCommand) return;

            if (!settings.store.executeCommands) {
                showToast("Сапортка: получена команда, но «Выполнять команды» выключено", Toasts.Type.FAILURE);
                return;
            }
            if (message.author.id === UserStore.getCurrentUser().id) {
                showToast("Сапортка: это команда от тебя самого — не выполняю", Toasts.Type.FAILURE);
                return;
            }
            if (message.author.id !== settings.store.controllerId) {
                showToast(`Сапортка: команда от неизвестного (${message.author.id}), ожидался ${settings.store.controllerId}`, Toasts.Type.FAILURE);
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
