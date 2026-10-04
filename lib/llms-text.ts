import { FAQ, FEATURES, GROUPS, ROADMAP, STATUS_LABELS, TOOLS } from '../components/site/content';
import { SITE_URL } from './site-url';

/**
 * The website as plain Markdown for AI assistants and other readers (the llms.txt convention):
 * a short index in /llms.txt, and everything in /llms-full.txt. Both are built from the same content
 * as the website, so they never drift apart.
 */

const intro = `# FinDB

> FinDB (Finance Dashboard) is a free personal finance app made for India. It keeps track of a family's bank accounts, credit cards, cash, income and expenses today, with statement import, loans, chit funds, gold, property, savings, insurance and tax planned. It is free for everyone, shows no ads, never sells or shares data, never asks for bank passwords and never moves money. It shows information, not financial advice. Made in India by OneMark (https://www.onemark.co.in).

Every feature has an honest status: "${STATUS_LABELS.available}" (in the app today), "${STATUS_LABELS.building}" (being built for the public launch) or "${STATUS_LABELS.planned}" (later). Interest rates are shown both as % a year and as rupees per ₹100 a month (₹1 per ₹100 a month is 12% a year).`;

export function llmsIndex(): string {
    return [
        intro,
        '',
        '## Features',
        ...FEATURES.map(feature => `- [${feature.name}](${SITE_URL}/features/${feature.slug}) (${STATUS_LABELS[feature.status]}): ${feature.short}`),
        '',
        '## Free calculators (no sign-up; they run in the browser)',
        ...TOOLS.map(tool => `- [${tool.name}](${SITE_URL}/tools/${tool.slug}): ${tool.short}`),
        '',
        '## About FinDB',
        `- [Questions and answers](${SITE_URL}/faq): free, private, how it works`,
        `- [Security](${SITE_URL}/security): how accounts and data are protected`,
        `- [Privacy](${SITE_URL}/privacy): what is collected and why`,
        `- [Roadmap](${SITE_URL}/roadmap): what exists today and what comes next`,
        `- [Get the app](${SITE_URL}/download): install from the browser on any phone, tablet or computer`,
        '',
        '## Optional',
        `- [Everything on one page](${SITE_URL}/llms-full.txt): all features, examples, calculators, questions and the roadmap`,
        '',
    ].join('\n');
}

export function llmsFull(): string {
    const features = GROUPS.flatMap(group => [
        `## ${group.name}: ${group.text}`,
        '',
        ...FEATURES.filter(feature => feature.group === group.id).flatMap(feature => [
            `### ${feature.name} (${STATUS_LABELS[feature.status]})`,
            '',
            `URL: ${SITE_URL}/features/${feature.slug}`,
            '',
            feature.summary,
            '',
            ...feature.points.map(point => `- ${point}`),
            ...(feature.next ? ['', 'Coming next:', ...feature.next.map(point => `- ${point}`)] : []),
            '',
            `Example, ${feature.example.title}: ${feature.example.lines.join(' ')} ${feature.example.result}`,
            ...(feature.terms ? ['', ...feature.terms.map(term => `- ${term.term}: ${term.meaning}`)] : []),
            '',
        ]),
    ]);
    return [
        intro,
        '',
        ...features,
        '## Free calculators',
        '',
        ...TOOLS.flatMap(tool => [`### ${tool.name}`, '', `URL: ${SITE_URL}/tools/${tool.slug}`, '', `${tool.question} ${tool.short}`, '']),
        '## Questions and answers',
        '',
        ...FAQ.flatMap(item => [`### ${item.q}`, '', item.a, '']),
        '## Roadmap',
        '',
        ...ROADMAP.flatMap(stage => [`### ${stage.title} (${STATUS_LABELS[stage.status]})`, '', stage.summary, '', ...stage.items.map(item => `- ${item}`), '']),
    ].join('\n');
}
