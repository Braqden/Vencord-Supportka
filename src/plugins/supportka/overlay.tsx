/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brqden_
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { ChannelStore, GuildMemberStore, GuildRoleStore, RestAPI, showToast, UserStore, VoiceStateStore } from "@webpack/common";

export interface OverlayRole {
    roleId: string;
    label: string;
    persist: boolean;
}

export interface OverlayOptions {
    guildId: string;
    roles: OverlayRole[];
    allowMainWindow?: boolean;
}

const logger = new Logger("supportka-overlay");

const BADGE_ATTR = "data-vc-supportka-overlay-badge";

const ROLE_CACHE_TTL = 5 * 60 * 1000;
const GUILD_ROLES_TTL = 10 * 60 * 1000;
const FADE_DELAY = 3000;

let options: OverlayOptions | null = null;
let observer: MutationObserver | null = null;
let scanTimer: number | undefined;
let scanInterval: number | undefined;
let scanning = false;

const SCAN_INTERVAL = 5000;

const roleCache = new Map<string, string[]>();
const fadeAt = new Map<string, number>();
const roleIconCache = new Map<string, { url?: string; emoji?: string; } | null>();
const guildRolesCache = new Map<string, { at: number; roles: Map<string, { name: string; icon: string | null; }> | null; }>();
const toastTimes = new Map<string, number>();

const OVERLAY_SENTINEL_ID = "__OVERLAY__SENTINEL__";

function isOverlay(): boolean {
    try {
        if (window.__OVERLAY__) return true;
        if (document.getElementById(OVERLAY_SENTINEL_ID)) return true;
        if (/overlay/i.test(window.location.href ?? "")) return true;
    } catch (e) {
        logger.warn("isOverlay: не удалось определить окружение:", e);
    }
    return false;
}

function where(): string {
    return isOverlay() ? "overlay" : "main";
}

function debugToast(message: string): void {
    try {
        showToast(message);
    } catch (e) {
        logger.warn("showToast недоступен:", e);
    }
}

function throttledToast(key: string, message: string, ms = 5000): void {
    const now = Date.now();
    const last = toastTimes.get(key);
    if (last && now - last < ms) return;
    toastTimes.set(key, now);
    debugToast(message);
}

const VOICE_KEY = "supportka.overlay.voice";
const OVERLAY_DATA_KEY = "supportka.overlay.data";
const OVERLAY_CHANNEL = "supportka-overlay";
const PUSH_TTL = 15000;
const PUSH_THROTTLE = 2000;

interface MemberBadge {
    uid: string;
    displayName: string;
    label: string | null;
    roleId: string | null;
    persist: boolean;
    icon: { url?: string; emoji?: string; } | null;
}

interface OverlayPushData {
    type: "overlay-data";
    guildId: string;
    channelId: string;
    ts: number;
    members: MemberBadge[];
}

let pushed: OverlayPushData | null = null;
let overlayChannel: BroadcastChannel | null = null;
let lastPush = 0;

function writeVoiceStorage(guildId: string, channelId: string): void {
    try {
        localStorage.setItem(VOICE_KEY, JSON.stringify({ guildId, channelId, ts: Date.now() }));
    } catch (e) {
        logger.warn("localStorage недоступен:", e);
    }
}

function readVoiceStorage(): { guildId: string; channelId: string; } | null {
    try {
        const raw = localStorage.getItem(VOICE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw) as { guildId?: string; channelId?: string; };
        if (data.guildId && data.channelId) return { guildId: data.guildId, channelId: data.channelId };
    } catch (e) {
        logger.warn("localStorage чтение не удалось:", e);
    }
    return null;
}

function loadPushedData(): void {
    try {
        const raw = localStorage.getItem(OVERLAY_DATA_KEY);
        if (raw) pushed = JSON.parse(raw) as OverlayPushData;
    } catch (e) {
        logger.warn("overlay data чтение не удалось:", e);
    }
}

function pushToOverlay(payload: OverlayPushData): void {
    const now = Date.now();
    if (now - lastPush < PUSH_THROTTLE) return;
    lastPush = now;
    try {
        localStorage.setItem(OVERLAY_DATA_KEY, JSON.stringify(payload));
    } catch (e) {
        logger.warn("localStorage.setItem (overlay data) не удался:", e);
    }
    try {
        if (!overlayChannel) overlayChannel = new BroadcastChannel(OVERLAY_CHANNEL);
        overlayChannel.postMessage(payload);
    } catch (e) {
        logger.warn("BroadcastChannel недоступен:", e);
    }
}

function setupOverlayChannel(): void {
    try {
        overlayChannel = new BroadcastChannel(OVERLAY_CHANNEL);
        overlayChannel.onmessage = (e: MessageEvent) => {
            const data = e.data as OverlayPushData | { type: string; ts?: number; } | null;
            if (!data || typeof data !== "object") return;
            if (isOverlay()) {
                if (data.type === "overlay-data") {
                    pushed = data as OverlayPushData;
                    scheduleScan();
                }
            } else if (data.type === "overlay-ack") {
                throttledToast("overlayack", "supportka [main]: оверлей получил данные ✓");
                logger.info("Overlay ACK получен:", data.ts);
            }
        };
    } catch (e) {
        logger.warn("BroadcastChannel не поддерживается:", e);
    }
}

function getDisplayName(guildId: string, userId: string): string {
    try {
        const member = GuildMemberStore.getMember(guildId, userId) as { nick?: string | null; } | undefined;
        if (member?.nick) return member.nick;
        const user = UserStore.getUser(userId) as { username?: string; } | undefined;
        if (user?.username) return user.username;
    } catch (e) {
        logger.warn("getDisplayName ошибка:", e);
    }
    return userId;
}

function resolveGuildForChannel(channelId: string): string | null {
    try {
        const channel = ChannelStore.getChannel(channelId) as { guild_id?: string; } | undefined;
        if (channel?.guild_id) return channel.guild_id;
    } catch (e) {
        logger.warn("ChannelStore недоступен:", e);
    }
    return null;
}

function collectMyChannel(all: unknown, myId: string): string | null {
    if (!all || typeof all !== "object") return null;
    for (const [k, v] of Object.entries(all as Record<string, any>)) {
        if (!v || typeof v !== "object") continue;
        // v может быть VoiceState (плоский: userId→VoiceState) либо Record<userId, VoiceState> (группированный по guildId)
        if (typeof v.channelId === "string" || typeof v.guildId === "string") {
            if (k === myId && v.channelId) return v.channelId as string;
        } else {
            const mine = v[myId];
            if (mine?.channelId) return mine.channelId as string;
        }
    }
    return null;
}

function getMyVoiceGuild(): { guildId: string | null; channelId: string; detail: string; } {
    let myId: string | undefined;
    try {
        myId = UserStore.getCurrentUser()?.id;
    } catch (e) {
        myId = undefined;
    }
    const parts: string[] = [`myId=${myId ?? "НЕТ"}`];

    try {
        if (myId) {
            const state = VoiceStateStore.getVoiceStateForUser(myId) as { guildId?: string; channelId?: string; } | undefined;
            parts.push(`primary=channel=${state?.channelId ?? "нет"},guild=${state?.guildId ?? "нет"}`);
            if (state?.channelId) {
                const guildId = state.guildId ?? resolveGuildForChannel(state.channelId);
                if (guildId) {
                    writeVoiceStorage(guildId, state.channelId);
                    return { guildId, channelId: state.channelId, detail: parts.join(";") };
                }
            }
        } else {
            parts.push("primary=пропущен (нет myId)");
        }
    } catch (e) {
        parts.push(`primary=ошибка:${String(e)}`);
    }

    try {
        const all = VoiceStateStore.getVoiceStates();
        const fromAll = myId ? collectMyChannel(all, myId) : null;
        if (fromAll) {
            const guildId = resolveGuildForChannel(fromAll);
            parts.push(`all=channel=${fromAll},guild=${guildId ?? "нет"}`);
            if (guildId) {
                writeVoiceStorage(guildId, fromAll);
                return { guildId, channelId: fromAll, detail: parts.join(";") };
            }
        } else {
            parts.push("all=нет");
        }
    } catch (e) {
        parts.push(`all=ошибка:${String(e)}`);
    }

    const fromStorage = isOverlay() ? readVoiceStorage() : null;
    parts.push(`storage=${fromStorage ? `channel=${fromStorage.channelId},guild=${fromStorage.guildId}` : "нет"}`);
    if (fromStorage) return { guildId: fromStorage.guildId, channelId: fromStorage.channelId, detail: parts.join(";") };

    return { guildId: null, channelId: "", detail: parts.join(";") };
}

async function getRoles(guildId: string, userId: string): Promise<string[] | null> {
    const cached = roleCache.get(userId);
    if (cached) return cached;

    let roles: string[] | null = null;

    try {
        const member = GuildMemberStore.getMember(guildId, userId) as { roles?: string[]; } | undefined;
        if (member?.roles?.length) roles = member.roles;
    } catch (e) {
        logger.warn("GuildMemberStore недоступен:", e);
    }

    if (!roles) {
        try {
            const { body } = await RestAPI.get({ url: `/guilds/${guildId}/members/${userId}` });
            roles = body?.roles?.length ? body.roles : [];
        } catch (e) {
            logger.warn(`REST-запрос ролей для ${userId} не удался:`, e);
            return null;
        }
    }

    if (!roles) return null;

    roleCache.set(userId, roles);
    window.setTimeout(() => roleCache.delete(userId), ROLE_CACHE_TTL);
    return roles;
}

async function getGuildRoleMap(guildId: string): Promise<Map<string, { name: string; icon: string | null; }> | null> {
    const cached = guildRolesCache.get(guildId);
    if (cached && Date.now() - cached.at < GUILD_ROLES_TTL) return cached.roles;

    let map: Map<string, { name: string; icon: string | null; }> | null = null;

    try {
        const snapshot = GuildRoleStore.getRolesSnapshot(guildId) as Record<string, { id: string; name: string; icon?: string | null; }>;
        if (snapshot) {
            const entries = Object.values(snapshot);
            if (entries.length) {
                map = new Map();
                for (const role of entries) {
                    map.set(role.id, { name: role.name, icon: role.icon ?? null });
                }
            }
        }
    } catch (e) {
        logger.warn("GuildRoleStore.getRolesSnapshot недоступен:", e);
    }

    if (!map) {
        try {
            const { body } = await RestAPI.get({ url: `/guilds/${guildId}/roles` });
            if (Array.isArray(body) && body.length) {
                map = new Map();
                for (const role of body) {
                    map.set(role.id, { name: role.name ?? "", icon: role.icon ?? null });
                }
            }
        } catch (e) {
            logger.warn(`REST-запрос ролей сервера ${guildId} не удался:`, e);
        }
    }

    guildRolesCache.set(guildId, { at: Date.now(), roles: map });
    return map;
}

async function resolveRole(guildId: string, memberRoles: string[]): Promise<OverlayRole | null> {
    if (!options?.roles.length) return null;

    // 1) совпадение по ID роли
    for (const role of options.roles) {
        if (memberRoles.includes(role.roleId)) return role;
    }

    // 2) совпадение по имени роли на сервере
    const roleMap = await getGuildRoleMap(guildId);
    if (roleMap) {
        const exact = new Map<string, string>();
        const loose: Array<{ roleId: string; name: string; }> = [];
        for (const [roleId, info] of roleMap) {
            const key = info.name.trim().toLowerCase();
            if (!key) continue;
            if (!exact.has(key)) exact.set(key, roleId);
            loose.push({ roleId, name: key });
        }
        for (const role of options.roles) {
            const label = role.label.trim().toLowerCase();
            if (!label) continue;
            const exactId = exact.get(label);
            if (exactId && memberRoles.includes(exactId)) return role;
        }
        for (const role of options.roles) {
            const label = role.label.trim().toLowerCase();
            if (!label) continue;
            for (const { roleId, name } of loose) {
                if (memberRoles.includes(roleId) && (name.includes(label) || label.includes(name))) return role;
            }
        }
    }

    return null;
}

function iconFromRaw(icon: string, roleId: string): { url?: string; emoji?: string; } | null {
    if (icon.startsWith("emoji:") || icon.startsWith("a:")) {
        const id = icon.split(":")[2];
        if (!id) return null;
        const animated = icon.startsWith("a:");
        return { url: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=32` };
    }

    if (/^[0-9a-f]+$/i.test(icon)) {
        return { url: `${location.protocol}//${window.GLOBAL_ENV.CDN_HOST}/role-icons/${roleId}/${icon}.png?size=32` };
    }

    return { emoji: icon };
}

async function getRoleIconData(guildId: string, roleId: string): Promise<{ url?: string; emoji?: string; } | null> {
    if (roleIconCache.has(roleId)) return roleIconCache.get(roleId) ?? null;

    const roleMap = await getGuildRoleMap(guildId);
    let raw = roleMap?.get(roleId)?.icon ?? null;

    if (!raw) {
        try {
            const role = GuildRoleStore.getRole(guildId, roleId) as { icon?: string | null; } | undefined;
            raw = role?.icon ?? null;
        } catch (e) {
            logger.warn("GuildRoleStore.getRole недоступен:", e);
        }
    }

    const data = raw ? iconFromRaw(raw, roleId) : null;
    if (data) roleIconCache.set(roleId, data);
    return data;
}

function ensureBadgeParent(el: HTMLElement): void {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
}

function hasDirectText(el: HTMLElement): boolean {
    for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()) return true;
    }
    return false;
}

function findRowContainer(img: HTMLImageElement): HTMLElement | null {
    let el = img.parentElement;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
        if (findFirstNameElement(el)) return el;
    }
    return null;
}

function findFirstNameElement(row: HTMLElement): HTMLElement | null {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT);
    let el = walker.nextNode() as HTMLElement | null;
    while (el) {
        if (el.tagName !== "IMG" && hasDirectText(el)) return el;
        el = walker.nextNode() as HTMLElement | null;
    }
    return null;
}

function findNameElements(name: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    const target = name.trim().toLowerCase();
    if (!target) return out;
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
    let el = walker.nextNode() as HTMLElement | null;
    while (el) {
        if (hasDirectText(el)) {
            const text = el.textContent?.trim().toLowerCase();
            if (text && text === target) out.push(el);
        }
        el = walker.nextNode() as HTMLElement | null;
    }
    return out;
}

function insertBadgeByName(badge: HTMLElement, name: string, marker: string): boolean {
    for (const nameEl of findNameElements(name)) {
        const parent = nameEl.parentElement;
        if (!parent || parent.querySelector(marker)) continue;
        nameEl.insertAdjacentElement("afterend", badge);
        logger.info(`Значок вставлен к нику «${name}»`);
        return true;
    }
    return false;
}

function badgeIconFromData(icon: { url?: string; emoji?: string; } | null): HTMLElement | null {
    if (!icon) return null;
    if (icon.url) {
        const img = document.createElement("img");
        img.src = icon.url;
        img.alt = "";
        img.style.cssText = "width:14px;height:14px;display:block;border-radius:3px;flex:0 0 auto;";
        return img;
    }
    if (icon.emoji) {
        const span = document.createElement("span");
        span.textContent = icon.emoji;
        span.style.cssText = "font-size:11px;line-height:1;display:block;";
        return span;
    }
    return null;
}

async function createBadge(member: MemberBadge): Promise<HTMLElement> {
    const badge = document.createElement("span");
    badge.setAttribute(BADGE_ATTR, "true");
    badge.style.cssText = "display:inline-flex;align-items:center;gap:2px;background:#5865f2;color:#fff;border-radius:6px;font-size:10px;line-height:1;padding:2px 4px;font-weight:700;pointer-events:none;box-shadow:0 1px 2px rgb(0 0 0 / 50%);white-space:nowrap;vertical-align:middle;";

    const icon = badgeIconFromData(member.icon);
    if (icon) badge.appendChild(icon);

    if (member.label) {
        const label = document.createElement("span");
        label.textContent = member.label;

        if (icon && !member.persist) {
            const existing = fadeAt.get(member.uid);
            const at = existing ?? Date.now() + FADE_DELAY;
            if (!existing) fadeAt.set(member.uid, at);
            const remaining = at - Date.now();
            label.style.transition = "opacity 0.5s ease";
            if (remaining <= 0) {
                label.style.opacity = "0";
            } else {
                window.setTimeout(() => {
                    label.style.opacity = "0";
                }, remaining);
            }
        }

        badge.appendChild(label);
    }
    return badge;
}

async function applyBadge(member: MemberBadge): Promise<void> {
    const badge = await createBadge(member);
    const marker = `[${BADGE_ATTR}]`;

    if (isOverlay() && insertBadgeByName(badge, member.displayName, marker)) return;

    for (const img of document.querySelectorAll<HTMLImageElement>("img[src]")) {
        const src = img.getAttribute("src") ?? "";
        if (!(src.includes(`/avatars/${member.uid}/`) || src.includes(`/users/${member.uid}/avatars/`))) continue;

        // значок рядом с ником (как серверный тег)
        const row = findRowContainer(img);
        if (row) {
            const nameEl = findFirstNameElement(row);
            if (nameEl && !nameEl.parentElement?.querySelector(marker)) {
                nameEl.insertAdjacentElement("afterend", badge);
                logger.info(`Значок «${member.label}» вставлен к нику ${member.uid}`);
                return;
            }
        }

        // фолбэк — угол аватара
        const parent = img.parentElement;
        if (!parent) continue;
        if (parent.querySelector(marker)) return;
        ensureBadgeParent(parent);
        parent.appendChild(badge);
        logger.info(`Значок «${member.label}» применён к аватару ${member.uid}`);
        return;
    }
}

function removeBadge(parent: HTMLElement): void {
    parent.querySelectorAll(`[${BADGE_ATTR}]`).forEach(badge => badge.remove());
}

function removeBadgesFor(member: MemberBadge): void {
    if (isOverlay()) {
        for (const nameEl of findNameElements(member.displayName)) {
            const parent = nameEl.parentElement;
            if (parent) removeBadge(parent);
        }
    }
    for (const parent of findAvatarParents(member.uid)) {
        const img = parent.querySelector("img[src]") as HTMLImageElement | null;
        const row = img ? findRowContainer(img) : null;
        removeBadge(row ?? parent);
    }
}

function findAvatarParents(userId: string): HTMLElement[] {
    const parents: HTMLElement[] = [];
    for (const img of document.querySelectorAll<HTMLImageElement>("img[src]")) {
        const src = img.getAttribute("src") ?? "";
        if (src.includes(`/avatars/${userId}/`) || src.includes(`/users/${userId}/avatars/`)) {
            const parent = img.parentElement;
            if (parent && !parents.includes(parent)) parents.push(parent);
        }
    }
    return parents;
}

function findAvatarUsers(): string[] {
    const users = new Set<string>();
    for (const img of document.querySelectorAll<HTMLImageElement>("img[src]")) {
        const src = img.getAttribute("src") ?? "";
        const m = src.match(/(?:guilds\/\d{17,20}\/users\/|\/avatars\/)(\d{17,20})\//);
        if (m) users.add(m[1]);
    }
    return [...users];
}

async function scan(): Promise<void> {
    if (!options || scanning) return;
    scanning = true;
    try {
        await doScan();
    } catch (e) {
        logger.warn("scan ошибка:", e);
    } finally {
        scanning = false;
    }
}

async function doScan(): Promise<void> {
    if (!options) return;

    let myId: string | undefined;
    try {
        myId = UserStore.getCurrentUser()?.id;
    } catch (e) {
        logger.warn("UserStore недоступен:", e);
    }

    const overlay = isOverlay();
    const usePushed = overlay && pushed && pushed.guildId === options.guildId && Date.now() - pushed.ts < PUSH_TTL;

    const voice = usePushed
        ? { guildId: pushed!.guildId, channelId: pushed!.channelId, detail: `данные главного окна (${Math.round((Date.now() - pushed!.ts) / 1000)}с назад)` }
        : getMyVoiceGuild();

    if (!voice.guildId || !voice.channelId) {
        logger.warn("Нет голосового состояния", voice.detail);
        if (!overlay) throttledToast("nvoice", `supportka [main]: ты не в голосовом канале (${voice.detail})`, 15000);
        return;
    }

    if (voice.guildId !== options.guildId) {
        logger.info(`Сервер ${voice.guildId} не является целевым (${options.guildId})`);
        if (!overlay) throttledToast("wrongguild", `supportka [main]: значки только для сервера ${options.guildId} (сейчас: ${voice.guildId})`, 15000);
        return;
    }

    let members: MemberBadge[] = [];
    if (usePushed) {
        members = pushed!.members ?? [];
        logger.info(`[overlay] данные из главного окна: участников ${members.length}`);
    } else {
        let states: Record<string, { channelId?: string; } | undefined> = {};
        try {
            states = VoiceStateStore.getVoiceStatesForChannel(voice.channelId) as Record<string, { channelId?: string; } | undefined>;
        } catch (e) {
            logger.warn("getVoiceStatesForChannel недоступен:", e);
        }

        let memberIds = Object.keys(states);
        if (!memberIds.length && overlay) {
            memberIds = findAvatarUsers();
            logger.info(`Участники: сторы пусты, из аватаров DOM: ${memberIds.length}`);
        }
        if (!memberIds.length) {
            throttledToast("nochan", `supportka [${where()}]: в канале никого нет`, 15000);
            return;
        }

        for (const uid of memberIds) {
            const roles = await getRoles(voice.guildId, uid);
            if (!roles) {
                logger.warn(`Роли для ${uid} не получены`);
                continue;
            }
            const role = await resolveRole(voice.guildId, roles);
            const icon = role ? await getRoleIconData(voice.guildId, role.roleId) : null;
            members.push({
                uid,
                displayName: getDisplayName(voice.guildId, uid),
                label: role?.label ?? null,
                roleId: role?.roleId ?? null,
                persist: role?.persist ?? false,
                icon
            });
        }
    }

    if (!overlay) {
        pushToOverlay({ type: "overlay-data", guildId: voice.guildId, channelId: voice.channelId, ts: Date.now(), members });
        throttledToast("push", `supportka [main]: оверлей: отправлено данных (значков: ${members.filter(m => m.label).length})`);
    }

    if (overlay) {
        let matched = 0;
        for (const member of members) {
            if (member.label) {
                matched++;
                await applyBadge(member);
            } else {
                removeBadgesFor(member);
            }
            if (member.uid === myId && member.label) {
                throttledToast(`me:${member.uid}`, `supportka [overlay]: я=${member.uid}, значок=${member.label}`);
            }
        }
        throttledToast("summary", `supportka [overlay]: в канале ${members.length}, совпадений ${matched}`);
    }
}

function scheduleScan(): void {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
        scanTimer = undefined;
        void scan();
    }, 200);
}

export function startOverlay(opts: OverlayOptions): void {
    const overlay = isOverlay();
    logger.info(`startOverlay: isOverlay=${overlay}, allowMainWindow=${opts.allowMainWindow === true}, сервер=${opts.guildId}, ролей настроено=${opts.roles.length}`);
    if (overlay || opts.allowMainWindow) {
        debugToast(`supportka [${where()}]: запущен, ролей: ${opts.roles.length}`);
    }
    if (!overlay && opts.allowMainWindow !== true) return;
    options = opts;
    setupOverlayChannel();
    if (overlay) {
        loadPushedData();
        try {
            overlayChannel?.postMessage({ type: "overlay-ack", ts: Date.now() });
        } catch (e) {
            logger.warn("ack не отправлен:", e);
        }
        window.addEventListener("storage", e => {
            if (e.key === VOICE_KEY || e.key === OVERLAY_DATA_KEY) {
                if (e.key === OVERLAY_DATA_KEY) loadPushedData();
                scheduleScan();
            }
        });
    }
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"]
    });
    scheduleScan();
    startScanning();
}

function startScanning(): void {
    if (scanInterval) return;
    scanInterval = window.setInterval(() => void scan(), SCAN_INTERVAL);
}

export function stopOverlay(): void {
    logger.info("stopOverlay");
    observer?.disconnect();
    observer = null;
    if (scanTimer) {
        window.clearTimeout(scanTimer);
        scanTimer = undefined;
    }
    if (scanInterval) {
        window.clearInterval(scanInterval);
        scanInterval = undefined;
    }
    document.querySelectorAll<HTMLElement>(`[${BADGE_ATTR}]`).forEach(badge => badge.remove());
    try {
        overlayChannel?.close();
    } catch (e) {
        logger.warn("канал не закрыт:", e);
    }
    overlayChannel = null;
    pushed = null;
    options = null;
    scanning = false;
}
