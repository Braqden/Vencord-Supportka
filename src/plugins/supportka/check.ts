/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brqden_
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type CheckSeverity = "error" | "warn";

export interface CheckViolation {
    field: string;
    severity: CheckSeverity;
    message: string;
}

export interface CheckProfileInput {
    nick?: string | null;
    globalName?: string | null;
    status?: string | null;
    bio?: string | null;
    pronouns?: string | null;
}

export interface CheckOptions {
    bannedWords?: string[];
    allowedLinks?: string[];
    bannedLinks?: string[];
}

interface TextRule {
    re: RegExp;
    message: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wordRe = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu");

const SEXUAL_RULES: TextRule[] = [
    { re: /нюдс|скиньт?е?\s+нюд/i, message: "Запрос/упоминание нюдсов" },
    { re: /дроч/i, message: "Сексуальный контент (мастурбация)" },
    { re: /ху[йеёиюя]/i, message: "Мат/сексуальный контент" },
    { re: /пенис|письк|пиписьк|вагин|влагалищ|клитор/i, message: "Сексуальный контент" },
    { re: /минет|оральн/i, message: "Сексуальный контент" },
    { re: /анал[а-яё]*/i, message: "Сексуальный контент" },
    { re: /вста(?:е|ё)т\s+(?:на\s+)?(?:девоч|мальчик)/i, message: "Упоминание сексуального возбуждения" },
    { re: /хочу\s+секс|ищу\s+секс|секс\s+со\s+мной|для\s+секс|секс-?услуг|интим\s*за/i, message: "Запрос интима" },
    { re: /порн(?:о|у|а|ку)|смотреть\s+порн/i, message: "Порнографический контент" }
];

const ORIENTATION_RULES: TextRule[] = [
    { re: /(?:^|[^\p{L}\p{N}])ге[йи](?:$|[^\p{L}\p{N}])/iu, message: "Упоминание ориентации (гей)" },
    { re: /лесбиян/i, message: "Упоминание ориентации (лесбиянка)" },
    { re: /(?:^|[^\p{L}\p{N}])транс(?:$|[^\p{L}\p{N}])|трансгендер|транссексуал/iu, message: "Упоминание ориентации/идентичности (транс)" },
    { re: /бисексуал|пансексуал|асексуал/i, message: "Упоминание ориентации" }
];

const DRUG_RULES: TextRule[] = [
    { re: /кокаин|героин|мефедрон|метамфетамин|амфетамин|экстази|марихуан|гашиш|шмаль|закладк|кладмен/i, message: "Упоминание/пропаганда наркотиков" },
    { re: /(?:люблю|продаю|куплю|употребляю|принимаю|нюхну|пробовал(?:а)?|банчу|закинусь)\s+наркотик/i, message: "Упоминание/пропаганда наркотиков" },
    { re: /курю\s+трав|травку/i, message: "Упоминание наркотиков" },
    { re: /(?:^|[^\p{L}\p{N}])кокс(?:$|[^\p{L}\p{N}])/iu, message: "Упоминание наркотиков" },
    { re: /(?:^|[^\p{L}\p{N}])спайс(?:$|[^\p{L}\p{N}])/iu, message: "Упоминание наркотиков" }
];

const NAZI_RULES: TextRule[] = [
    { re: /гитлер|нацист|нацизм|национал-?социалист|хайль|зиг\s+хайль|фашист|14\/88|1488|вермахт|ку-клукс-клан|эсэсовец/i, message: "Одобрение нацизма/фашизма" }
];

const SELFHARM_RULES: TextRule[] = [
    { re: /суицид|самоубийств|селфхарм|убью\s+себя|себя\s+убью|хочу\s+умереть|устал\s+жить|не\s+хочу\s+жить|режу\s+себя|порежу\s+себя|вскроюсь|повешусь|петлю|спрыгн(?:у|уть)/i, message: "Призыв/упоминание суицида или селфхарма" }
];

const DISCRIMINATION_RULES: TextRule[] = [
    { re: /хохол|кацап|москаль|жид|чурка|черномазый|бабуин|пиндос|америкос/i, message: "Оскорбление по национальному/расовому признаку" },
    { re: /(?:^|[^\p{L}\p{N}])хач(?:ик|ок)?(?:$|[^\p{L}\p{N}])/iu, message: "Оскорбление по национальному признаку" },
    { re: /у\s+женщин\s+нет\s+права|баб\s+на\s+кухн|место\s+женщин|женщины\s+должны|женщины\s+не\s+умеют|девочк[аи]\s+(?:не|должны)\s+уметь|женский\s+пол\s+(?:ниже|глупее)/i, message: "Дискриминация по половому признаку" },
    { re: /смерть\s+(?:русск|украинц|еврей|кавказ|неграм|хохл|кацап|жид)/i, message: "Призыв/дискриминация по признаку национальности" }
];

const INSULT_RULES: TextRule[] = [
    { re: /мразь|пизд|тварь|долбоёб|долбоеб|еблан|ебан(?:ый|утый|ал)|хуйло|мудак|мудил|гандон|пидор|пидорас|педик|педераст|шалав|шлюх|бляд|урод|уёбищ|уебан|гнид|скотин|выбляд|подонок|сволоч|стерв|курв|гадин|падл|дегенерат|имбецил|кретин|кончен(?:ый|ая)|проститутк|распиздяй/i, message: "Тяжёлое/среднее оскорбление" },
    { re: /твою\s+мать|мать\s+твою|ебат[ьл]?\s+(?:твою|вашу)|вы[её]б(?:ал|ывать)/i, message: "Тяжёлое оскорбление" },
    { re: /(?:^|[^\p{L}\p{N}])сук(?:а|ин)(?:$|[^\p{L}\p{N}])/iu, message: "Тяжёлое оскорбление" },
    { re: /(?:^|[^\p{L}\p{N}])даун(?:$|[^\p{L}\p{N}])/iu, message: "Тяжёлое оскорбление" },
    { re: /(?:^|[^\p{L}\p{N}])петух(?:$|[^\p{L}\p{N}])/iu, message: "Тяжёлое оскорбление" }
];

const MONEY_RE = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b\d{16}\b|реквизит|переведи(?:те)?[^.!?\n]{0,25}карт|перевод\s+(?:на\s+)?(?:карту|сбер)|тинькофф|альфа-?банк|карта\s+для\s+перевод|пополн(?:ить|ение)\s+карт|киви|qiwi|прода[юм]|продаж|аккаунт[а-яё]*\s+(?:в|на)\s+продажу|купить\s+аккаунт|цена\s+ник|донат/i;

const BANNED_NAME_RULES: TextRule[] = [
    { re: /арт[её]м\s*вавилов|art(?:e|o)m\s*vavilov|артёмвавилов/i, message: "Запрещённое имя (Артём Вавилов)" }
];

function stripSpoilers(text: string): string {
    return text.replace(/\|\|[\s\S]*?\|\|/g, match => " ".repeat(match.length));
}

const URL_SOURCE_RE = /https?:\/\/[^\s<>"')\]]+|(?:^|[\s([])[\w-]+\.(?:gg|me|tv|be|lol|com|ru|net|org|link|xyz|io)\/[^\s<>"')\]]*/gi;

function extractUrls(text: string): string[] {
    const urls: string[] = [];
    for (const match of text.matchAll(URL_SOURCE_RE)) {
        const url = match[0].replace(/^[\s(["]+|["')\]]+$/g, "").replace(/[.,!?;:]+$/, "");
        if (url && !urls.includes(url)) urls.push(url);
    }
    return urls;
}

function classifyUrl(url: string, allowed: string[], banned: string[]): "allowed" | "error" | "warn" {
    const u = url.toLowerCase();
    if (/scam|screamer/.test(u) || banned.some(key => u.includes(key.toLowerCase()))) return "error";
    if (/guns\.lol|pinterest|xivivid|xevivid|ксививайд|lounge|youtube\.com\/watch|youtu\.be\/|instagram|tiktok\.com|twitter\.com|x\.com|steamcommunity|open\.spotify|soundcloud|vk\.com\/(?:id|im|feed|wall)/.test(u) || allowed.some(key => u.includes(key.toLowerCase()))) return "allowed";
    return "warn";
}

export function runCheck(input: CheckProfileInput, options: CheckOptions = {}): CheckViolation[] {
    const violations: CheckViolation[] = [];
    const seen = new Set<string>();
    const push = (violation: CheckViolation) => {
        const key = `${violation.field}|${violation.message}`;
        if (seen.has(key)) return;
        seen.add(key);
        violations.push(violation);
    };

    const bannedWordRules: TextRule[] = (options.bannedWords ?? [])
        .map(word => word.trim())
        .filter(Boolean)
        .map(word => ({
            re: new RegExp(escapeRegExp(word), "i"),
            message: `Запрещённое слово из списка: ${word}`
        }));

    const fields: Array<{ name: string; text?: string | null; }> = [
        { name: "Имя", text: input.nick },
        { name: "Глобальное имя", text: input.globalName },
        { name: "Статус", text: input.status },
        { name: "Обо мне", text: input.bio },
        { name: "Местоимения", text: input.pronouns }
    ];

    for (const field of fields) {
        const text = field.text?.trim();
        if (!text) continue;

        if (field.name === "Имя" || field.name === "Глобальное имя") {
            for (const rule of BANNED_NAME_RULES) {
                if (rule.re.test(text)) push({ field: field.name, severity: "error", message: rule.message });
            }
        }

        for (const rules of [SEXUAL_RULES, ORIENTATION_RULES, DRUG_RULES, NAZI_RULES, SELFHARM_RULES, DISCRIMINATION_RULES, INSULT_RULES]) {
            for (const rule of rules) {
                if (rule.re.test(text)) push({ field: field.name, severity: "error", message: rule.message });
            }
        }

        for (const rule of bannedWordRules) {
            if (rule.re.test(text)) push({ field: field.name, severity: "error", message: rule.message });
        }

        const plainText = stripSpoilers(text);

        for (const url of extractUrls(plainText)) {
            const severity = classifyUrl(url, options.allowedLinks ?? [], options.bannedLinks ?? []);
            if (severity === "error") {
                push({ field: field.name, severity, message: `Ссылка «${url}» — скример/скам, убрать полностью` });
            } else if (severity === "warn") {
                push({ field: field.name, severity, message: `Ссылка «${url}» — публичный ресурс, убрать под спойлер` });
            }
        }

        if (MONEY_RE.test(plainText)) {
            push({ field: field.name, severity: "warn", message: "Реквизиты/продажа — убрать под спойлер" });
        }
    }

    return violations;
}
