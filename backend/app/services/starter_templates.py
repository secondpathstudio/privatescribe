"""Starter-template catalog for the first-run onboarding wizard.

A new admin picks one or more use cases in the wizard; seed_for_user() then
creates the matching `simple` Markdown templates for them. Template content
uses {{...}} instruction markers — see services/ollama_client.py for the
fill-in contract.

The clinical and therapy templates here are first-draft skeletons, meant to be
reviewed and tuned by a domain expert before launch.
"""
from datetime import datetime

from app.extensions import db
from app.models import Template


_SOAP_NOTE = """# Visit Note

## Subjective
{{Summarize what the patient reported — their symptoms, concerns, and relevant history, in their own words}}

## Objective
{{List the exam findings, vital signs, and measurements mentioned in the recording}}

## Assessment
{{Summarize the clinical assessment and any diagnoses discussed}}

## Plan
{{List the plan discussed — treatment, medications, follow-up, and referrals}}
"""

_VISIT_SUMMARY = """# Visit Summary

**What we discussed today:**
{{Summarize the main topics of the visit in plain, patient-friendly language}}

**Your care plan:**
{{List what the patient should do next — medications, lifestyle changes, and any tests or referrals}}

**Next steps:**
{{Note when the patient should follow up or check in, if it was mentioned}}
"""

_SESSION_NOTE_DAP = """# Session Note

## Data
{{Summarize what was observed and reported in the session — the client's presentation, mood, and the main topics discussed}}

## Assessment
{{Summarize the clinician's assessment of the client's current status and progress}}

## Plan
{{Describe the plan for upcoming sessions and any goals or actions before the next one}}
"""

_PROGRESS_NOTE = """# Progress Note

**Presenting concerns:**
{{Summarize the concerns or topics the client raised}}

**Progress toward goals:**
{{Describe any progress, setbacks, or changes since the last session}}

**Plan:**
{{Note the plan going forward and any next steps}}
"""

_MEETING_SUMMARY = """# Meeting Summary

**Overview:**
{{Summarize the purpose and main discussion of the meeting in two or three sentences}}

## Key points
{{List the key points and topics discussed}}

## Decisions
{{List any decisions that were made}}

## Action items
{{List the action items, noting who is responsible for each where it was mentioned}}
"""

_STANDUP_NOTES = """# Standup Notes

## Updates
{{For each person who spoke, summarize what they completed and what they are working on next}}

## Blockers
{{List any blockers or issues that were raised}}

## Follow-ups
{{List anything that needs follow-up after the standup}}
"""

_INTERVIEW_NOTES = """# Interview Notes

**Summary:**
{{Summarize the main themes and takeaways from the interview in a short paragraph}}

## Topics discussed
{{List the main topics or questions covered, with a brief summary of the response to each}}

## Notable quotes
{{Pull out any notable direct quotes, attributed to the speaker}}
"""

_RESEARCH_INTERVIEW = """# Research Interview

**Participant background:**
{{Summarize any background or context the participant shared about themselves}}

## Themes
{{Identify and summarize the main themes that emerged in the conversation}}

## Key quotes
{{List notable verbatim quotes, attributed to the speaker, that illustrate the themes}}

## Open questions
{{Note any questions left unanswered or worth following up on}}
"""

_GENERAL_NOTE = """# Note

## Summary
{{Summarize the main points of the recording in a short paragraph}}

## Details
{{List the important details, points, or topics that were covered}}

## Action items
{{List any tasks, follow-ups, or next steps that were mentioned}}
"""

_CLEAN_TRANSCRIPT = """# Transcript

{{Rewrite the recording as clean, readable prose. Fix punctuation and capitalization and remove filler words and false starts, but keep all of the original content and meaning. Do not summarize or leave anything out.}}
"""


# use-case id -> {label, templates: [{name, content}, ...]}
STARTER_TEMPLATES = {
    "clinical": {
        "label": "Clinical visits",
        "templates": [
            {"name": "SOAP Note", "content": _SOAP_NOTE},
            {"name": "Visit Summary", "content": _VISIT_SUMMARY},
        ],
    },
    "therapy": {
        "label": "Therapy & counseling",
        "templates": [
            {"name": "Session Note (DAP)", "content": _SESSION_NOTE_DAP},
            {"name": "Progress Note", "content": _PROGRESS_NOTE},
        ],
    },
    "meetings": {
        "label": "Meetings",
        "templates": [
            {"name": "Meeting Summary", "content": _MEETING_SUMMARY},
            {"name": "Standup Notes", "content": _STANDUP_NOTES},
        ],
    },
    "interviews": {
        "label": "Interviews",
        "templates": [
            {"name": "Interview Notes", "content": _INTERVIEW_NOTES},
            {"name": "Research Interview", "content": _RESEARCH_INTERVIEW},
        ],
    },
    "general": {
        "label": "General notes",
        "templates": [
            {"name": "General Note", "content": _GENERAL_NOTE},
            {"name": "Clean Transcript", "content": _CLEAN_TRANSCRIPT},
        ],
    },
}


def catalog() -> list[dict]:
    """Use-case catalog for the wizard UI — [{id, label, templates: [name, ...]}]."""
    return [
        {
            "id": use_case,
            "label": spec["label"],
            "templates": [t["name"] for t in spec["templates"]],
        }
        for use_case, spec in STARTER_TEMPLATES.items()
    ]


def seed_for_user(user_id: str, use_cases: list[str]) -> list[Template]:
    """Create the starter templates for `use_cases`, owned by `user_id`.

    Unknown use-case ids are ignored; templates are de-duplicated by name so
    overlapping selections can't create duplicates. Rows are added to the
    session — the caller is responsible for committing.
    """
    created: list[Template] = []
    seen: set[str] = set()
    now = datetime.utcnow()
    for use_case in use_cases:
        spec = STARTER_TEMPLATES.get(use_case)
        if not spec:
            continue
        for entry in spec["templates"]:
            if entry["name"] in seen:
                continue
            seen.add(entry["name"])
            template = Template(
                name=entry["name"],
                template_type="simple",
                content=entry["content"].strip(),
                llm_model=None,
                created_at=now,
                updated_at=now,
                version=1,
                author_id=user_id,
            )
            db.session.add(template)
            created.append(template)
    return created
