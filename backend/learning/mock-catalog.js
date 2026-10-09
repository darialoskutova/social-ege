"use strict";

const VERSION = "2027-draft-v1";
const EXAM_MODEL = "EGE_SOCIAL_2027_DRAFT";

const sections = [
  ["human-society", "human_society", "Человек и общество / духовная культура", "человек и общество"],
  ["economics", "economics", "Экономика", "экономика"],
  ["social-relations", "social_relations", "Социальные отношения", "социология"],
  ["politics", "politics", "Политика", "политика"],
  ["law", "law", "Право", "право"],
];

const mocks = Object.freeze(sections.flatMap(([slug, focusSection, label, filename]) => (
  [1, 2, 3].map((variant) => Object.freeze({
    mockId: `${slug}-${variant}`,
    contentVersion: VERSION,
    examModel: EXAM_MODEL,
    title: `Тематический пробник · ${label}`,
    focusSection,
    sectionLabel: label,
    variant,
    taskCount: 25,
    maxScore: 58,
    timeMinutes: 210,
    downloadPath: `доп материалы/пробные варианты/${VERSION}/№${variant} Пробный ЕГЭ ${filename}.docx`,
  }))
)));

const byKey = new Map(mocks.map((mock) => [`${mock.mockId}:${mock.contentVersion}`, mock]));

function findMock(mockId, contentVersion) {
  return byKey.get(`${mockId}:${contentVersion}`) || null;
}

module.exports = { EXAM_MODEL, VERSION, findMock, mocks };
