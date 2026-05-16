import uuid
from datetime import datetime

from app.extensions import db


class Template(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(50), nullable=False)
    # 'simple'     — content is a Markdown skeleton with {{instructions}} that
    #                Ollama fills in a single pass at note time.
    # 'structured' — `structured` holds a typed Template tree (sections + fields
    #                + per-field strictness/prompts). Built with the external
    #                Expert template builder; content may be empty or hold a
    #                serialized markdown projection for backwards-compat read paths.
    template_type = db.Column(db.String(16), nullable=False, default='simple')
    content = db.Column(db.Text, nullable=True)
    structured = db.Column(db.JSON, nullable=True)
    # Ollama model tag (e.g. "llama3.2", "mistral:7b"). Null falls back to DEFAULT_OLLAMA_MODEL.
    llm_model = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = db.Column(db.Integer, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False)
    is_deleted_timestamp = db.Column(db.DateTime, nullable=True)

    notes = db.relationship('Note', backref='template', lazy=True)
    # Roles this template is shared with (many-to-many). A non-owner who holds
    # one of these roles sees the template, read-only.
    shared_roles = db.relationship('Role', secondary='template_roles', backref='templates', lazy=True)

    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)

    def __repr__(self):
        return f"<Template {self.name}>"
