#!/usr/bin/env python3
"""Audit Webium and build strict thematic EGE-2027 draft mock documents.

The source bank is read-only and stays outside the repository. Public manifests
never contain answers. A private audit with answer/criteria presence is written
to an ignored directory for local review.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import importlib.util
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

from docx import Document


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WEBIUM = ROOT.parent.parent / "егэ общество" / "webium_offline"
PRIVATE = ROOT / "tools" / "mock-bank" / ".private"
INDEX_FILE = ROOT / "data" / "webium-task-index.json"
MANIFEST_FILE = ROOT / "data" / "thematic-mocks.json"
FRONTEND_FILE = ROOT / "data" / "thematic-mocks.js"

EXAM_MODEL = "EGE_SOCIAL_2027_DRAFT"
CONTENT_VERSION = "2027-draft-v1"
OUTPUT = ROOT / "доп материалы" / "пробные варианты" / CONTENT_VERSION
SCORES = [1, 2, 1, 2, 2, 2, 2, 2, 1, 2, 2, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4, 3, 4, 6]
DIFFICULTY = {
    **{number: "basic" for number in (1, 3, 6, 8, 9, 12, 15, 16, 17, 18, 21, 22, 23)},
    **{number: "advanced" for number in (2, 4, 5, 7, 10, 11, 13, 14)},
    **{number: "high" for number in (19, 20, 24, 25)},
}

SECTION_MAP = {
    "Человек и Общество": "human_society",
    "Экономика": "economics",
    "Социология": "social_relations",
    "Политика": "politics",
    "Конституция": "law",
    "Право": "law",
}
SECTION_CODE = {
    "human_society": "1",
    "economics": "2",
    "social_relations": "3",
    "politics": "4",
    "law": "5",
}
SECTIONS = {
    "human_society": {
        "source": "Человек и Общество",
        "title": "Человек и общество / духовная культура",
        "filename": "человек и общество",
        "course_topics": [f"soc{number}" for number in range(1, 10)],
    },
    "economics": {
        "source": "Экономика",
        "title": "Экономика",
        "filename": "экономика",
        "course_topics": [f"eco{number}" for number in range(15, 29)],
    },
    "social_relations": {
        "source": "Социология",
        "title": "Социальные отношения",
        "filename": "социология",
        "course_topics": [f"soc{number}" for number in range(10, 15)],
    },
    "politics": {
        "source": "Политика",
        "title": "Политика",
        "filename": "политика",
        "course_topics": [f"pol{number}" for number in range(29, 43)],
    },
    "law": {
        "source": "Право",
        "title": "Право",
        "filename": "право",
        "course_topics": [f"law{number}" for number in range(43, 57)],
    },
}

# Webium metadata assigns these composite line-22 tasks to one subtheme even
# though answering them requires knowledge from several course sections. They
# remain indexed for traceability but are never eligible for a strict thematic
# mock.
QUARANTINED_SOURCE_IDS = {
    61228: "social task also requires the economics concept of unemployment",
    67587: "social task also tests a type of society, economy and education",
    20219: "social task also tests sources of household income",
    85452: "social task also tests taxation of personal income",
    36225: "politics task also tests an economic system and a type of society",
    81675: "politics task also tests fiscal policy and market competition",
    84770: "politics task also tests an economic function and civil law",
    37440: "law task also tests inflation, education and form of government",
}

# Line 22 is frequently a composite case. Its source metadata is not sufficient
# to prove thematic purity, so these 15 records were reviewed question by
# question and explicitly allowlisted for the corresponding section/variant.
REVIEWED_LINE22_SOURCE_IDS = {
    "human_society": [8107, 76635, 57939],
    "economics": [70674, 82833, 76631],
    "social_relations": [18358, 19116, 19288],
    "politics": [21975, 47499, 81674],
    "law": [22351, 32699, 83490],
}


def plain(markup: str | None) -> str:
    value = re.sub(r"<[^>]+>", " ", markup or "")
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def normalized(value: str) -> str:
    return re.sub(r"[^а-яёa-z0-9]+", " ", value.lower()).strip()


def fingerprint(task: dict) -> str:
    payload = normalized(plain(task.get("description")))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def word_grams(value: str, size: int = 5) -> set[tuple[str, ...]]:
    words = normalized(value).split()
    if len(words) < size:
        return {tuple(words)} if words else set()
    return set(zip(*(words[offset:] for offset in range(size))))


def similarity(left: set, right: set) -> float:
    return len(left & right) / min(len(left), len(right)) if left and right else 0.0


def task_sections(task: dict) -> set[str]:
    return {
        SECTION_MAP[item.get("theme", {}).get("name")]
        for item in task.get("subThemes", [])
        if item.get("theme", {}).get("name") in SECTION_MAP
    }


def subtopics(task: dict) -> list[str]:
    return sorted({item.get("name", "").strip() for item in task.get("subThemes", []) if item.get("name")})


def answer_payload(answers: dict, task: dict) -> dict:
    return answers.get(str(task["id"]), {}) or {}


def has_answer_or_criteria(answers: dict, task: dict) -> bool:
    payload = answer_payload(answers, task)
    correct = payload.get("correctAnswers") or task.get("correctAnswers") or {}
    if task.get("taskType") == "answer-with-numbers":
        return bool(correct.get("correctAnswer") or correct.get("correctOptions"))
    return bool(
        payload.get("hintsForSolution")
        or payload.get("explanation")
        or correct.get("explanation")
        or task.get("solution")
    )


def import_formatter(webium: Path):
    source = webium / "generate_practice_variants.py"
    spec = importlib.util.spec_from_file_location("webium_mock_formatter", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить форматтер: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_pairs(formatter, tasks: list[dict], answers: dict) -> list[dict]:
    pairs = []
    for pair in formatter.build_text_pairs(tasks):
        left, right = pair["task17"], pair["task18"]
        sections = task_sections(left) & task_sections(right)
        if len(sections) != 1:
            continue
        if left.get("maxScore") != 2 or right.get("maxScore") != 2:
            continue
        if not has_answer_or_criteria(answers, left) or not has_answer_or_criteria(answers, right):
            continue
        digest = hashlib.sha256(pair["fingerprint"].encode("utf-8")).hexdigest()[:20]
        pairs.append({**pair, "section": next(iter(sections)), "source_group_id": f"webium-text-{digest}"})
    return sorted(pairs, key=lambda item: (-item["matchScore"], item["task17"]["id"], item["task18"]["id"]))


def usable(task: dict, answers: dict, section: str, response: str, score: int) -> bool:
    description = plain(task.get("description")).lower()
    expected_type = "answer-with-numbers" if response == "short" else "free-answer"
    return (
        task.get("id") not in QUARANTINED_SOURCE_IDS
        and task_sections(task) == {section}
        and task.get("taskType") == expected_type
        and task.get("maxScore") == score
        and has_answer_or_criteria(answers, task)
        and "уже покупаю" not in description
        and "протестируй нашу отработку" not in description
        and not (
            response == "extended"
            and task.get("numberInKim") in (19, 20)
            and re.search(r"\b(?:текст\w*|автор\w*)", description)
        )
    )


def choose_candidate(
    candidates: list[dict],
    position: int,
    used_ids: set[int],
    used_grams: list[tuple[set, set[str]]],
    rng: random.Random,
    required_source_id: int | None = None,
) -> dict:
    preferred_lines = {
        19: [19, 20, 21, 23], 20: [20, 19, 21, 23], 21: [21, 19, 20, 23],
        22: [22, 24], 23: [23, 19, 20, 21], 24: [24, 22], 25: [25],
    }.get(position, [position])
    ranked = []
    for task in candidates:
        if required_source_id is not None and task["id"] != required_source_id:
            continue
        if task["id"] in used_ids:
            continue
        grams = word_grams(plain(task.get("description")))
        topics = set(subtopics(task))
        if any(topics & previous_topics and similarity(grams, previous) >= 0.82 for previous, previous_topics in used_grams):
            continue
        try:
            line_rank = preferred_lines.index(task.get("numberInKim"))
        except ValueError:
            line_rank = len(preferred_lines) + 1
        ranked.append((line_rank, rng.random(), task, grams))
    if not ranked:
        suffix = f" с source_id={required_source_id}" if required_source_id is not None else ""
        raise RuntimeError(f"Нет уникального задания для позиции {position}{suffix}")
    _, _, selected, grams = min(ranked, key=lambda item: (item[0], item[1]))
    used_ids.add(selected["id"])
    used_grams.append((grams, set(subtopics(selected))))
    return selected


def choose_pair(pairs: list[dict], section: str, used_ids: set[int], used_groups: set[str], used_grams: list[tuple[set, set[str]]]) -> dict:
    for pair in pairs:
        ids = {pair["task17"]["id"], pair["task18"]["id"]}
        if pair["section"] != section or ids & used_ids or pair["source_group_id"] in used_groups:
            continue
        grams = word_grams(" ".join(pair["passage"]))
        topics = set(subtopics(pair["task17"])) | set(subtopics(pair["task18"]))
        if any(topics & previous_topics and similarity(grams, previous) >= 0.82 for previous, previous_topics in used_grams):
            continue
        used_ids.update(ids)
        used_groups.add(pair["source_group_id"])
        used_grams.append((grams, topics))
        return pair
    raise RuntimeError(f"Нет связанного уникального комплекта 17–18 для {section}")


def task_metadata(task: dict, display_position: int, section: str, pair: dict | None = None) -> dict:
    source_number = int(task["numberInKim"])
    group_id = pair["source_group_id"] if pair else None
    return {
        "id": f"webium-{task['id']}",
        "display_position": display_position,
        "source_exam_task_number": source_number,
        "task_template": f"source-line-{source_number}-{task['taskType']}",
        "response_type": "short_numbers" if task["taskType"] == "answer-with-numbers" else "extended",
        "max_score": int(task["maxScore"]),
        "difficulty": DIFFICULTY.get(source_number, "unknown"),
        "section": section,
        "subtopic": subtopics(task),
        "codifier_codes": [f"{SECTION_CODE[section]}.*"],
        "content_version": CONTENT_VERSION,
        "source": (task.get("taskSource") or {}).get("name") or "offline Webium",
        "source_id": f"webium:{task['id']}",
        "source_group_id": group_id,
        "shared_stimulus_id": group_id,
        "depends_on": f"webium-{pair['task17']['id']}" if pair and display_position == 18 else None,
        "has_answer_or_criteria": True,
        "fingerprint": fingerprint(task),
    }


def build_variants(tasks: list[dict], answers: dict, pairs: list[dict]) -> list[dict]:
    rng = random.Random(20261009)
    used_ids: set[int] = set()
    used_groups: set[str] = set()
    used_grams: list[tuple[set, set[str]]] = []
    variants = []
    for section, details in SECTIONS.items():
        for variant in range(1, 4):
            selected = {}
            for position in range(1, 17):
                candidates = [task for task in tasks if usable(task, answers, section, "short", SCORES[position - 1])]
                selected[position] = choose_candidate(candidates, position, used_ids, used_grams, rng)
            pair = choose_pair(pairs, section, used_ids, used_groups, used_grams)
            selected[17], selected[18] = pair["task17"], pair["task18"]
            for position in range(19, 26):
                candidates = [task for task in tasks if usable(task, answers, section, "extended", SCORES[position - 1])]
                reviewed_source_id = (
                    REVIEWED_LINE22_SOURCE_IDS[section][variant - 1]
                    if position == 22
                    else None
                )
                selected[position] = choose_candidate(
                    candidates, position, used_ids, used_grams, rng, reviewed_source_id
                )
            mock_id = f"{section.replace('_', '-')}-{variant}"
            filename = f"№{variant} Пробный ЕГЭ {details['filename']}.docx"
            metadata = [
                task_metadata(selected[position], position, section, pair if position in (17, 18) else None)
                for position in range(1, 26)
            ]
            variants.append({
                "mock_id": mock_id,
                "content_version": CONTENT_VERSION,
                "exam_model": EXAM_MODEL,
                "title": f"Тематический пробник · {details['title']}",
                "focus_section": section,
                "section_label": details["title"],
                "variant": variant,
                "allowed_topics": details["course_topics"],
                "task_count": 25,
                "max_score": 58,
                "time_minutes": 210,
                "download_path": f"доп материалы/пробные варианты/{CONTENT_VERSION}/{filename}",
                "file": filename,
                "tasks": metadata,
                "_selected": selected,
                "_pair": pair,
            })
    return variants


def validate(variants: list[dict]) -> None:
    seen_sources = set()
    seen_fingerprints = set()
    expected_positions = list(range(1, 26))
    for mock in variants:
        tasks = mock["tasks"]
        assert mock["focus_section"] in SECTIONS
        assert len(tasks) == 25 and [task["display_position"] for task in tasks] == expected_positions
        assert [task["max_score"] for task in tasks] == SCORES
        assert sum(task["max_score"] for task in tasks) == mock["max_score"] == 58
        assert all(task["section"] == mock["focus_section"] for task in tasks)
        source_ids = [task["source_id"] for task in tasks]
        fingerprints = [task["fingerprint"] for task in tasks]
        assert len(source_ids) == len(set(source_ids))
        assert len(fingerprints) == len(set(fingerprints))
        assert not (set(source_ids) & seen_sources)
        assert not (set(fingerprints) & seen_fingerprints)
        seen_sources.update(source_ids)
        seen_fingerprints.update(fingerprints)
        task17, task18 = tasks[16], tasks[17]
        assert task17["source_group_id"] and task17["source_group_id"] == task18["source_group_id"]
        assert task18["depends_on"] == task17["id"]


def write_documents(formatter, variants: list[dict]) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for mock in variants:
        document = Document()
        formatter.configure(document)
        formatter.add_title(document, mock["section_label"], mock["variant"])
        formatter.add_student_tasks(document, mock["_selected"], mock["_pair"])
        document.core_properties.title = mock["title"]
        document.core_properties.author = "Дарья Лоскутова"
        document.save(OUTPUT / mock["file"])


def public_mock(mock: dict) -> dict:
    return {key: value for key, value in mock.items() if not key.startswith("_")}


def write_manifests(tasks: list[dict], answers: dict, pairs: list[dict], variants: list[dict]) -> None:
    group_by_id = {}
    for pair in pairs:
        group_by_id[pair["task17"]["id"]] = pair["source_group_id"]
        group_by_id[pair["task18"]["id"]] = pair["source_group_id"]
    index = []
    for task in tasks:
        sections = sorted(task_sections(task))
        index.append({
            "source_id": f"webium:{task['id']}",
            "source": (task.get("taskSource") or {}).get("name") or "offline Webium",
            "source_exam_task_number": task.get("numberInKim"),
            "task_template": f"source-line-{task.get('numberInKim')}-{task.get('taskType')}",
            "response_type": "short_numbers" if task.get("taskType") == "answer-with-numbers" else "extended",
            "max_score": task.get("maxScore"),
            "section": sections,
            "subtopic": subtopics(task),
            "codifier_codes": [f"{SECTION_CODE[s]}.*" for s in sections],
            "difficulty": DIFFICULTY.get(task.get("numberInKim"), "unknown"),
            "source_group_id": group_by_id.get(task["id"]),
            "has_attachments": bool(task.get("attachments")),
            "has_answer_or_criteria": has_answer_or_criteria(answers, task),
            "excluded_reason": QUARANTINED_SOURCE_IDS.get(task["id"]),
            "fingerprint": fingerprint(task),
        })
    INDEX_FILE.write_text(json.dumps({
        "generated_from": "offline Webium (source files are not copied)",
        "task_count": len(index),
        "exam_model": EXAM_MODEL,
        "tasks": index,
    }, ensure_ascii=False, separators=(",", ":")), "utf-8")

    public = [public_mock(mock) for mock in variants]
    MANIFEST_FILE.write_text(json.dumps({
        "exam_model": EXAM_MODEL,
        "official_status": "project",
        "official_source": "https://fipi.ru/ege/demoversii-specifikacii-kodifikatory",
        "content_version": CONTENT_VERSION,
        "score_schema": SCORES,
        "task_count": 25,
        "max_score": 58,
        "mocks": public,
    }, ensure_ascii=False, indent=2), "utf-8")
    frontend = [{key: mock[key] for key in (
        "mock_id", "content_version", "exam_model", "title", "focus_section", "section_label",
        "variant", "task_count", "max_score", "time_minutes", "download_path",
    )} for mock in public]
    FRONTEND_FILE.write_text(
        "window.THEMATIC_MOCKS=" + json.dumps(frontend, ensure_ascii=False, separators=(",", ":")) + ";\n",
        "utf-8",
    )

    PRIVATE.mkdir(parents=True, exist_ok=True)
    private_audit = [{
        "mock_id": mock["mock_id"],
        "content_version": mock["content_version"],
        "tasks": [{
            **meta,
            "text": plain(mock["_selected"][meta["display_position"]].get("description")),
            "answer_or_criteria_present": has_answer_or_criteria(answers, mock["_selected"][meta["display_position"]]),
            "answer_key": (
                answer_payload(answers, mock["_selected"][meta["display_position"]]).get("correctAnswers")
                or mock["_selected"][meta["display_position"]].get("correctAnswers")
            ),
            "criteria_or_explanation": {
                "explanation": answer_payload(
                    answers, mock["_selected"][meta["display_position"]]
                ).get("explanation"),
                "hints_for_solution": answer_payload(
                    answers, mock["_selected"][meta["display_position"]]
                ).get("hintsForSolution"),
                "solution": mock["_selected"][meta["display_position"]].get("solution"),
            },
        } for meta in mock["tasks"]],
    } for mock in variants]
    (PRIVATE / "thematic-mocks-audit.json").write_text(
        json.dumps(private_audit, ensure_ascii=False, indent=2), "utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--webium", type=Path, default=DEFAULT_WEBIUM)
    args = parser.parse_args()
    webium = args.webium.resolve()
    formatter = import_formatter(webium)
    offline_data = formatter.load_data()
    tasks = offline_data["tasks"]
    answers = offline_data["answers"]
    if len(tasks) != 3949 or len(answers) != 3949:
        raise RuntimeError("Неожиданная версия offline Webium")
    pairs = build_pairs(formatter, tasks, answers)
    variants = build_variants(tasks, answers, pairs)
    validate(variants)
    write_documents(formatter, variants)
    write_manifests(tasks, answers, pairs, variants)
    print(f"Проиндексировано заданий: {len(tasks)}")
    print(f"Связанных комплектов 17–18: {len(pairs)}")
    print(f"Собрано тематических пробников: {len(variants)}")
    print(f"Заданий в пробниках: {sum(mock['task_count'] for mock in variants)}")


if __name__ == "__main__":
    main()
