"""Thin wrapper over the local Ollama HTTP API.

list_installed_models() powers the template-builder dropdown.
generate_markdown() is the contract for how templates are filled in: bracketed
[instructions] inside the template are replaced with content extracted from the
raw transcript; everything else is preserved literally. Editing the system
prompt here changes template behavior across the app.
"""
import ollama

DEFAULT_OLLAMA_MODEL = "llama3.2"


def list_installed_models() -> list[dict]:
    """Returns [{"name": str, "parameter_size": str | None}, ...].

    Raises whatever ollama raises if the daemon is unreachable; the route
    handler decides how to surface that to the client.
    """
    response = ollama.list()
    raw_models = response.get('models', []) if isinstance(response, dict) else getattr(response, 'models', [])
    out = []
    for m in raw_models:
        # ollama 0.4.x returns objects with .model; older shapes used dict['name'].
        name = getattr(m, 'model', None) or getattr(m, 'name', None)
        if name is None and isinstance(m, dict):
            name = m.get('model') or m.get('name')
        if not name:
            continue

        # `details.parameter_size` is a human-readable string like "3.2B" or "7B"
        details = getattr(m, 'details', None)
        if details is None and isinstance(m, dict):
            details = m.get('details')
        parameter_size = None
        if details is not None:
            parameter_size = getattr(details, 'parameter_size', None)
            if parameter_size is None and isinstance(details, dict):
                parameter_size = details.get('parameter_size')

        out.append({"name": name, "parameter_size": parameter_size})
    return out


def generate_markdown(template, raw_note: str, note_details: dict, model_name: str) -> str:
    """Run the template-fill prompt against `model_name` and return the model's output."""
    response = ollama.chat(
        model=model_name,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are a professional note generator who can make any style note from a conversation transcription. Your job now is to make a note in the style of a {template.name} note.\n\n"
                    "### GOAL\n"
                    "You will be given a raw transcript of a conversation or recording and need to convert, summarize, or discuss the transcript based on the template provided "
                    "between the ###TEMPLATE### tags below. You can identify instructions for transcription between square brackets, for example: [Summarize the transcription] or [List any foods mentioned]. "
                    "You must follow the instructions inside the square brackets exactly "
                    "with information you extract from the transcript - please note there may be multiple sets of instructions or requests in a single transcript template.\n\n"
                    "###START TEMPLATE###\n"
                    f"{template.content}\n"
                    "###END TEMPLATE###\n\n"
                    "### STRICT RULES\n"
                    "1. **Do NOT** add or remove headings, colons, bullets, blank lines, or any other characters outside the [instructions].\n"
                    "2. If you feel there is not enough data to address the instruction, just include the instruction and a comment `I could not find enough data to answer this`.\n"
                    "3. Format all dates as MM/DD/YYYY.\n"
                    "4. Return the filled-in template **as plain text markdown**. No code fences, no extra commentary, no word “markdown”."
                    "5. Do not include any other text or explanation. Do not include the [] tags.\n"
                ),
            },
            {
                "role": "user",
                "content": (
                    "### context\n"
                    f"{note_details}\n\n"
                    "### raw note\n"
                    f"{raw_note}"
                ),
            },
        ],
        options={"temperature": 0.2},
    )
    return response["message"]["content"]
