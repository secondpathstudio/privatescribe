import click
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
from flask_jwt_extended import JWTManager, jwt_required, create_access_token, create_refresh_token, get_jwt_identity
import uuid
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS, cross_origin
from flask_migrate import Migrate
from faster_whisper import WhisperModel
import ollama
import os
from dotenv import load_dotenv
from pydub import AudioSegment
import io

app = Flask(__name__)
CORS(app, supports_credentials=True, origins=["http://localhost:3000"])

load_dotenv()

# Secret key for JWT encoding/decoding
app.config['SECRET_KEY'] = os.getenv('JWT_SECRET_KEY')  # Use a secure key in production
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=1)  # Access tokens expire after 1 hour

# SQLite Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///privatescribe.db'  # SQLite database
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
migrate = Migrate(app, db)

# JWT Manager
jwt = JWTManager(app)

# Load Faster-Whisper Model
model_size = "base"
device = "cpu"
compute_type = "int8"
whisper_model = WhisperModel(
    model_size,
    device=device,
    compute_type=compute_type
)

# User model (for authentication)
class User(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))  # UUID as primary key
    email = db.Column(db.String(100), unique=True, nullable=False)
    role = db.Column(db.String(50), default='user')  # Default role is 'user'
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    password = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship: A user has many notes
    notes = db.relationship('Note', backref='user', lazy=True, cascade='all, delete-orphan')
    
    # Relationship: A user can have many templates
    templates = db.relationship('Template', backref='user', lazy=True, cascade='all, delete-orphan')
    
    # Relationship: A user can have many participants
    participants = db.relationship('Participant', backref='user', lazy=True, cascade='all, delete-orphan')

    def __repr__(self):
        return f"<User {self.email}>"
    
# Note template model
class Template(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(50), nullable=False)
    content = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = db.Column(db.Integer, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False)
    is_deleted_timestamp = db.Column(db.DateTime, nullable=True)
    
    # Relationship: A template can be used by many notes
    notes = db.relationship('Note', backref='template', lazy=True)
    
    # Foreign key: Link the template to a user as author
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)

    def __repr__(self):
        return f"<Template {self.name}>"
    
class Participant(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=True)
    email = db.Column(db.String(100), unique=False, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Note relationship: A participant can be part of many notes
    notes = db.relationship('Note', secondary='note_participants', 
                                  back_populates='participants')
    
    # Foreign key: Link the participant to a user as author
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)

    def __repr__(self):
        return f"<Participant {self.first_name} {self.last_name}>"

# Define the association table for the many-to-many relationship
note_participants = db.Table('note_participants',
    db.Column('note_id', db.Integer, db.ForeignKey('note.id', ondelete='CASCADE'), primary_key=True),
    db.Column('participant_id', db.String, db.ForeignKey('participant.id', ondelete='CASCADE'), primary_key=True)
)

# Define the association table for the many-to-many relationship
user_participants = db.Table('user_participants',
    db.Column('user_id', db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
    db.Column('participant_id', db.String(36), db.ForeignKey('participant.id', ondelete='CASCADE'), primary_key=True)
)

# Note model
class Note(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    author_name = db.Column(db.String(100), nullable=False)
    note_date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    note_content_raw = db.Column(db.Text, nullable=False)
    note_content_markdown = db.Column(db.Text, nullable=False)
    note_type = db.Column(db.String(50), nullable=False)
    version = db.Column(db.Integer(), nullable=False, default=1)
    is_deleted = db.Column(db.Boolean, default=False)
    is_deleted_timestamp = db.Column(db.DateTime, nullable=True)
    
    # Foreign key: Link the note to a template
    template_id = db.Column(db.Integer, db.ForeignKey('template.id'), nullable=True)
    
    # Foreign key: Link the note to a user as author
    author_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    
    # Foreign key: Link the note to participants - many-to-many relationship
    participants = db.relationship('Participant', secondary='note_participants', back_populates='notes')

    def __repr__(self):
        return f"<Note {self.id}>"
    
with app.app_context():
    db.create_all()


# API route to create a new user (for authentication)
@app.route('/api/signup', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
def register():
    data = request.get_json()

    # Validate input data
    if not data or not all(k in data for k in ['firstName', 'lastName', 'email', 'password']):
        return jsonify({"error": "Missing name, email, or password."}), 400

    # Check if user already exists
    if User.query.filter_by(email=data['email']).first():
        return jsonify({"error": "User email already exists"}), 400

    # Hash the password before saving
    hashed_password = generate_password_hash(data['password'], method='pbkdf2:sha256')

    # Create new user with UUID id
    new_user = User(
        first_name=data['firstName'], 
        last_name=data['lastName'], 
        email=data['email'], 
        password=hashed_password,
        )
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"message": "User created successfully"}), 201

@app.route('/api/validateToken', methods=['GET'])
@jwt_required()
def validate_token():
    current_user = get_jwt_identity()
    return jsonify({"message": "Valid token", "user": current_user})

@app.route('/api/getAllUsers', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
def get_all_users():
    users = User.query.all()
    if not users:
        return jsonify({"error": "No users found"}), 404

    users_list = [{
        "id": user.id,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "createdAt": user.created_at,
        "lastLogin": user.last_login
    } for user in users]
    
    return jsonify(users_list)

# API route to authenticate and get JWT token
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()

    # Validate input data
    if not data.get('email') or not data.get('password'):
        return jsonify({"error": "Email and password are required"}), 400

    # Check if user exists
    user = User.query.filter_by(email=data['email']).first()

    # Validate password (using hashed password comparison)
    if user and check_password_hash(user.password, data['password']):
        # Create a new JWT token
        access_token = create_access_token(identity=user.id)
        refresh_token = create_refresh_token(identity=user.id)
        
        # Update the last login time
        user.lastLogin = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": user.id,
                "email": user.email,
                "firstName": user.first_name,
                "lastName": user.last_name,
                "lastLogin": user.last_login
            }}), 200

    return jsonify({"error": "Invalid username or password"}), 401

@app.route("/refresh", methods=["POST"])
@jwt_required(refresh=True)  # Requires a valid refresh token
def refresh():
    current_user = get_jwt_identity()
    new_access_token = create_access_token(identity=current_user)
    return jsonify(access_token=new_access_token)

# API route to create a note (requires authentication)
@app.route('/api/notes', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_note():
    data = request.get_json()
    print('creating note', data)
    
    note_date = datetime.now()
    if 'noteDate' in data:
            note_date = datetime.fromisoformat(data['noteDate'].replace("Z", ""))

    # Validate required fields
    if not all(k in data for k in (
        'noteContentRaw', 
        'noteContentMarkdown', 
        'authorName',
        'noteTemplate', 
        'noteDate',)):
        print('missing required fields', data)
        return jsonify({"error": "Missing required fields"}), 400
    
    # Validate template
    if 'templateId' in data and data['templateId']:
        template = Template.query.get(data['templateId'])
        if not template:
            print('template not found', data['templateId'])
            return jsonify({"error": f"Template with ID {data['templateId']} not found"}), 400
    
    # validate participantIds
    if not isinstance(data['participants'], list):
        return jsonify({"error": "participants must be a list"}), 400
    
    
    # Validate each participant has required fields
    try:
        for participant in data['participants']:
            if not isinstance(participant, dict):
                return jsonify({"error": "Each participant must be an object"}), 400
            if 'firstName' not in participant:
                return jsonify({"error": "Each participant must have a firstName"}), 400
    except Exception as e:
        # Log the error
        participants = []  # Fallback to empty list if there's an error
        print(f"Error accessing participants: {str(e)}")
        
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Handle participants - convert dicts to Participant objects
    participants = []
    if 'participants' in data:
        for participant_data in data['participants']:
            if isinstance(participant_data, dict):
                # Check if participant already exists by ID
                if 'id' in participant_data:
                    existing_participant = Participant.query.get(participant_data['id'])
                    if existing_participant:
                        participants.append(existing_participant)
                        continue
                
                # Create new participant object
                participant = Participant(
                    id=participant_data.get('id'),
                    first_name=participant_data.get('firstName', ''),
                    last_name=participant_data.get('lastName', ''),
                    email=participant_data.get('email', ''),
                    # Add other fields as needed
                )
                participants.append(participant)
            else:
                # Already a Participant object
                participants.append(participant_data)

    # Create a new note instance
    new_note = Note(
        note_content_raw=data['noteContentRaw'],
        note_content_markdown=data['noteContentMarkdown'],
        note_type='text',
        note_date=note_date,
        created_at=datetime.now(),
        updated_at=datetime.now(),
        author_name=data['authorName'],
        version=data['version'],
        template_id=data['noteTemplate'],
        is_deleted=False,
        is_deleted_timestamp=None,
        participants=participants,  
        author_id=current_user  # Link the note to the current user (UUID)
    )
    
    print('adding note', new_note)

    # Add the note to the database
    db.session.add(new_note)
    db.session.flush()
    db.session.commit()
    
    # # Get participant info for the response
    participants = []
    try:
        for participant in new_note.participants:
            participant_info = {
                "id": participant.id,
                "first_name": participant.firstName,
                "last_name": participant.lastName if hasattr(participant, 'lastName') else None,
                "email": participant.email if hasattr(participant, 'email') else None
            }

            participants.append(participant_info)
    except Exception as e:
        # Log the error
        print(f"Error accessing participants: {str(e)}")
        participants = []

    return jsonify({
        "id": new_note.id,
        "createdAt": new_note.created_at,
        "updatedAt": new_note.updated_at,
        "noteContentRaw": new_note.note_content_raw,
        "noteContentMarkdown": new_note.note_content_markdown,
        "participants": data['participants'],  # Return the original participants data
        "noteType": new_note.note_type,
        "authorId": new_note.author_id,
        "version": new_note.version
    }), 201

# API route to get a single note by ID (requires authentication)
@app.route('/api/notes/<string:id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_note(id):
    note = Note.query.get(id)
    if not note:
        return jsonify({"error": "Note not found"}), 404

    print('getting note', note)
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the note belongs to the current user
    if note.author_id != current_user:
        return jsonify({"error": "Not authorized to access this note"}), 403

    # Get participant information
    participants = []
    try:
        for participant in note.participants:
            participant_info = {
                "id": participant.id,
                "firstName": participant.first_name,
                "lastName": participant.last_name if hasattr(participant, 'last_name') else None,
                "email": participant.email if hasattr(participant, 'email') else None
            }
            participants.append(participant_info)
    except Exception as e:
        # Log the error
        print(f"Error accessing participants: {str(e)}")
        participants = []
        
    return jsonify({
        "id": note.id,
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "noteDate": note.note_date,
        "noteContentRaw": note.note_content_raw,
        "noteContentMarkdown": note.note_content_markdown,
        "authorId": note.author_id,
        "authorName": note.author_name,
        "noteType": note.note_type,
        "noteTemplate": note.template_id,
        "participants": participants,
        "version": note.version,
        "isDeleted": note.is_deleted,
        "isDeletedTimestamp": note.is_deleted_timestamp,
    })

# API route to update a note by ID (requires authentication)
@app.route('/api/notes/<string:id>', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_note(id):
    note = Note.query.get(id)
    if not note:
        return jsonify({"error": "Note not found"}), 404
    
    # Get the current user from the JWT
    current_user = get_jwt_identity()
    # Ensure the note belongs to the current user
    if note.author_id != current_user:
        return jsonify({"error": "Not authorized to update this note"}), 403
    
    data = request.get_json()
    
    # Update note attributes if provided
    note.note_content_markdown = data.get('noteContentMarkdown', note.note_content_markdown)
    note.note_type = data.get('noteType', note.note_type)
    note.updated_at = datetime.now()
    note.version = note.version + 1
    
    # Update participants if provided
    if 'participants' in data and isinstance(data['participants'], list):
        # Clear all existing participants - better approach
        note.participants.clear()
        
        # Process new participants
        for participant_data in data['participants']:
            # Validate required fields
            if not isinstance(participant_data, dict) or 'id' not in participant_data or 'firstName' not in participant_data:
                return jsonify({"error": "Each participant must have an id and firstName"}), 400
            
            participant_id = participant_data['id']
            
            # Check if participant exists
            participant = Participant.query.get(participant_id)
            if participant:
                # Update existing participant
                participant.first_name = participant_data['firstName']
                participant.last_name = participant_data.get('lastName', '')
                participant.email = participant_data.get('email', '')
            else:
                # Create new participant
                participant = Participant(
                    id=participant_id,
                    first_name=participant_data['firstName'],
                    last_name=participant_data.get('lastName', ''),
                    email=participant_data.get('email', '')
                )
                db.session.add(participant)
            
            # Add to note's participants
            note.participants.append(participant)
    
    try:
        # Commit the changes to the database
        db.session.commit()
        
        # Refresh the note to get updated relationships
        db.session.refresh(note)
        
        # Get updated participant info for the response
        participants = []
        for participant in note.participants:
            participant_info = {
                "id": participant.id,
                "firstName": participant.first_name,
                "lastName": participant.last_name,
                "email": participant.email
            }
            participants.append(participant_info)
        
        return jsonify({
            "id": note.id,
            "createdAt": note.created_at,
            "updatedAt": note.updated_at,
            "noteDate": note.note_date,
            "noteContentRaw": note.note_content_raw,
            "noteContentMarkdown": note.note_content_markdown,
            "participants": participants,
            "noteType": note.note_type,
            "authorId": note.author_id,
            "authorName": note.author_name,
            "noteTemplate": note.template_id,
            "version": note.version,
            "isDeleted": note.is_deleted,
            "isDeletedTimestamp": note.is_deleted_timestamp
        })
        
    except Exception as e:
        db.session.rollback()
        print(f"Error updating note: {str(e)}")
        return jsonify({"error": "Failed to update note"}), 500

# API endpoint to mark a note as deleted (soft delete)
@app.route('/api/notes/<string:id>/delete', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_note_as_deleted(id):
    note = Note.query.get(id)
    if not note:
        return jsonify({"error": "Note not found"}), 404
        
    print('marking note as deleted', note)
    
    # Get the current user from the JWT
    current_user = get_jwt_identity()
    
    # Ensure the note belongs to the current user
    #TODO add ability for admin to delete any note
    if note.author_id != current_user:
        return jsonify({"error": "Not authorized to delete this note"}), 403
        
    # Mark the note as deleted with current timestamp
    note.is_deleted = True
    note.is_deleted_timestamp = datetime.now()
    note.updated_at = datetime.now()
    
    # Commit the changes to the database
    db.session.commit()
    
    return jsonify({
        "id": note.id,
        "message": "Note added to trash, will be permanently deleted in 30 days",
        "deletedAt": note.is_deleted_timestamp
    })

# API endpoint to restore a deleted note
@app.route('/api/notes/<string:id>/restore', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_note_as_restored(id):
    note = Note.query.get(id)
    if not note:
        return jsonify({"error": "Note not found"}), 404
        
    # Get the current user from the JWT
    current_user = get_jwt_identity()
    
    # Ensure the note belongs to the current user
    #TODO add ability for admin to delete any note
    if note.author_id != current_user:
        return jsonify({"error": "Not authorized to delete this note"}), 403
        
    # Mark the note as deleted with current timestamp
    note.is_deleted = False
    note.is_deleted_timestamp = None
    note.updated_at = datetime.now()
    
    # Commit the changes to the database
    db.session.commit()
    
    return jsonify({
        "id": note.id,
        "message": "Note restored successfully.",
    })

# API route to get all notes for a specific userId (requires authentication)
@app.route('/api/notes/user/<string:user_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_notes_for_user(user_id):
    print("Getting notes for userId: " + user_id)
    
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the user is authorized to access notes for the given authorId
    if current_user != user_id:
        return jsonify({"error": "Not authorized to access notes for this user"}), 403

    notes = Note.query.filter_by(author_id=user_id).all()
    if not notes:
        return jsonify([]), 200

    notes_list = []
    
    try:
        for note in notes:
            # Get just the participant IDs for each note
            participant_ids = [participant.id for participant in note.participants]
            
            # Create note object with participants
            note_data = {
                "id": note.id,
                "createdAt": note.created_at,
                "updatedAt": note.updated_at,
                "noteDate": note.note_date,
                "noteContentRaw": note.note_content_raw,
                "noteContentMarkdown": note.note_content_markdown,
                "participantIds": participant_ids,  # Include participant ids only for this route
                "noteType": note.note_type,
                "authorId": note.author_id,
                "isDeleted": note.is_deleted,
                "isDeletedTimestamp": note.is_deleted_timestamp,
            }
            
            notes_list.append(note_data)
    except Exception as e:
        # Log the error
        print(f"Error accessing participants: {str(e)}")
        notes_list = []
        
    return jsonify(notes_list)

# API route to create a template (requires authentication)
@app.route('/api/templates', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_template():
    data = request.get_json()

    # Validate required fields
    if not all(k in data for k in (
        'name', 
        'content')):
        return jsonify({"error": "Missing required fields"}), 400
        
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Create a new note instance
    new_template = Template(
        content=data['content'],
        name=data['name'],
        created_at=datetime.now(),
        updated_at=datetime.now(),
        version=1,
        author_id=current_user  # Link the note to the current user (UUID)
    )
    
    print('adding template', new_template)

    # Add the note to the database
    db.session.add(new_template)
    db.session.commit()

    return jsonify({
        "id": new_template.id,
        "createdAt": new_template.created_at,
        "updatedAt": new_template.updated_at,
        "content": new_template.content,
        "name": new_template.name,
        "authorId": new_template.author_id,
        "version": new_template.version
    }), 201

#TODO make route to get all (non-deleted) templates and separate route for getting deleted templates
# API route to get all templates for a specific userId (requires authentication)
@app.route('/api/templates/user/<string:user_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_templates_for_user(user_id):
    print("Getting templates for userId: " + user_id)
    
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the user is authorized to access notes for the given authorId
    if current_user != user_id:
        return jsonify({"error": "Not authorized to access templates for this user"}), 403

    templates = Template.query.filter_by(author_id=user_id).all()
    if not templates:
        print('no templates found for user', current_user)
        return jsonify([]), 200

    template_list = []
    
    try:
        for template in templates:            
            # Create template object
            template_data = {
                "id": template.id,
                "content": template.content,
                "name": template.name,
                "version": template.version,
                "createdAt": template.created_at,
                "updatedAt": template.updated_at,
                "authorId": template.author_id,
                "isDeleted": template.is_deleted,
                "isDeletedTimestamp": template.is_deleted_timestamp,
            }
            
            template_list.append(template_data)
    except Exception as e:
        # Log the error
        print(f"Error getting templates: {str(e)}")
        template_list = []
        
    return jsonify(template_list)

# API route to get a single template by ID (requires authentication)
@app.route('/api/templates/<string:id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_template(id):
    template = Template.query.get(id)
    if not template:
        return jsonify({"error": "Template not found"}), 404

    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the note belongs to the current user
    if template.author_id != current_user:
        return jsonify({"error": "Not authorized to access this note"}), 403
        
    return jsonify({
        "id": template.id,
        "name": template.name,
        "content": template.content,
        "isDeleted": template.is_deleted,
        "isDeletedTimestamp": template.is_deleted_timestamp,
        "createdAt": template.created_at,
        "updatedAt": template.updated_at,
        "authorId": template.author_id,
        "version": template.version
    })

# API route to update a template by ID (requires authentication)
@app.route('/api/templates/<string:id>', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def update_template(id):
    template = Template.query.get(id)
    if not template:
        return jsonify({"error": "Note not found"}), 404

    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the note belongs to the current user
    if template.author_id != current_user:
        return jsonify({"error": "Not authorized to update this note"}), 403

    data = request.get_json()

    # Update note attributes if provided
    template.name = data.get('name', template.name)
    template.content = data.get('content', template.content)
    template.updated_at = datetime.now()
    template.version = template.version + 1
    
    # Commit the changes to the database
    db.session.commit()

    return jsonify({
        "id": template.id,
        "createdAt": template.created_at,
        "updatedAt": template.updated_at,
        "content": template.content,
        "name": template.name,
        "authorId": template.author_id,
        "version": template.version,
        "isDeleted": template.is_deleted,
        "isDeletedTimestamp": template.is_deleted_timestamp
    })

# API endpoint to mark a template as deleted (soft delete)
@app.route('/api/templates/<string:id>/delete', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_template_as_deleted(id):
    template = Template.query.get(id)
    if not template:
        return jsonify({"error": "Template not found"}), 404
        
    # Get the current user from the JWT
    current_user = get_jwt_identity()
    
    # Ensure the note belongs to the current user
    #TODO add ability for admin to delete any note
    if template.author_id != current_user:
        return jsonify({"error": "Not authorized to delete this note"}), 403
        
    # Mark the note as deleted with current timestamp
    template.is_deleted = True
    template.is_deleted_timestamp = datetime.now()
    template.updated_at = datetime.now()
    
    # Commit the changes to the database
    db.session.commit()
    
    return jsonify({
        "id": template.id,
        "message": "Note added to trash, will be permanently deleted in 30 days",
        "deletedAt": template.is_deleted_timestamp
    })

# API endpoint to mark a template as deleted (soft delete)
@app.route('/api/templates/<string:id>/restore', methods=['PUT'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def mark_template_as_restored(id):
    template = Template.query.get(id)
    if not template:
        return jsonify({"error": "Template not found"}), 404
        
    # Get the current user from the JWT
    current_user = get_jwt_identity()
    
    # Ensure the note belongs to the current user
    #TODO add ability for admin to delete any note
    if template.author_id != current_user:
        return jsonify({"error": "Not authorized to delete this note"}), 403
        
    # Mark the note as deleted with current timestamp
    template.is_deleted = False
    template.is_deleted_timestamp = None
    template.updated_at = datetime.now()
    
    # Commit the changes to the database
    db.session.commit()
    
    return jsonify({
        "id": template.id,
        "message": "Template restored successfully.",
    })

# API route to create a participant (requires authentication)
@app.route('/api/participants', methods=['POST'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def create_participant():
    data = request.get_json()
    print('creating participant', data)

    # Validate required fields
    if not all(k in data for k in (
        'firstName', )):
        return jsonify({"error": "Missing required fields"}), 400
        
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Create a new note instance
    new_participant = Participant(
        first_name=data['firstName'],
        last_name=data['lastName'] if 'lastName' in data else None,
        email=data['email'] if 'email' in data else None,
        created_at=datetime.now(),
        updated_at=datetime.now(),
        author_id=current_user  # Link the note to the current user (UUID)
    )
    
    print('adding template', new_participant)

    # Add the note to the database
    db.session.add(new_participant)
    db.session.commit()

    return jsonify({
        "id": new_participant.id,
        "createdAt": new_participant.created_at,
        "updatedAt": new_participant.updated_at,
        "firstName": new_participant.first_name,
        "lastName": new_participant.last_name,
        "authorId": new_participant.author_id,
    }), 201

# API route to get all users participants (requires authentication)
@app.route('/api/participants/<string:user_id>', methods=['GET'])
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@jwt_required()
def get_participants_for_user(user_id):
    print("Getting participants")
    
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the user is authorized to access notes for the given authorId
    if current_user != user_id:
        return jsonify({"error": "Not authorized to access templates for this user"}), 403

    participants = Participant.query.filter_by(author_id=user_id).all()
    if not participants:
        print('no participants found for user', current_user)
        return jsonify([]), 200

    participant_list = []
    
    try:
        for participant in participants:            
            # Create template object
            participant_data = {
                "id": participant.id,
                "firstName": participant.first_name,
                "lastName": participant.last_name,
                "email": participant.email,
                "createdAt": participant.created_at,
                "updatedAt": participant.updated_at,
            }
            
            participant_list.append(participant_data)
    except Exception as e:
        # Log the error
        print(f"Error getting participants: {str(e)}")
        participant_list = []
        
    return jsonify(participant_list)


# Function to convert audio to WAV format (if needed)
def convert_audio(audio_data, format):
    audio = AudioSegment.from_file(io.BytesIO(audio_data), format=format)
    wav_io = io.BytesIO()
    audio.export(wav_io, format="wav")
    wav_io.seek(0)
    return wav_io

@app.route('/api/transcribe', methods=['POST'])
@jwt_required()
def transcribe():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    format = file.filename.split('.')[-1]
    
    file.seek(0)  # Reset file pointer to the beginning
    audio_data = file.read()

    # Convert audio to WAV if necessary
    if format.lower() != "wav":
        audio_data = convert_audio(audio_data, format)
    else:
        audio_data = io.BytesIO(audio_data)

    # Transcribe audio using Faster-Whisper
    segments, _ = whisper_model.transcribe(audio_data, language="en")

    # Combine segments into a single note    
    note = " ".join(segment.text for segment in segments)

    return jsonify({
        "raw_note": note,
        # "formatted_markdown": formatted_markdown
    })

@app.route('/api/getMarkdown', methods=['POST'])
@jwt_required()
def getMarkdown():
    request_data = request.get_json()
    
    if not request_data:
        return jsonify({"error": "No JSON data provided"}), 400
    
    # Extract raw_note and note_details
    raw_note = request_data.get('raw_note')
    note_details = request_data.get('note_details', {})
    
    # Validate required fields
    if not all(k in note_details for k in (
        'note_date', 
        'author_id',
        'template_id',
        'participants')):
        return jsonify({"error": "Missing required fields in note_details"}), 400
    
    # Fetch template
    template = None
    if 'template_id' in note_details and note_details['template_id']:
        template = Template.query.get(note_details['template_id'])
        if not template:
            return jsonify({"message": f"Template with ID {note_details['template_id']} not found"}), 400
    else:
        return jsonify({"error": "Invalid template_id"}), 400
    
    print(f"template: {template.content}")
    
    #TODO add author + participant names?
    # Format note with Ollama LLM
    formatted_markdown = ollama.chat(
        model="llama3.2",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional meeting-minutes assistant.\n\n"
                    "### GOAL\n"
                    "Transform the raw transcript into **exactly** the Markdown structure shown "
                    "between the ###TEMPLATE### tags below, identify instructions for transcription between square brackets: [instructions]. "
                    "You must follow the instructions inside the square brackets exactly "
                    "with information you extract from the transcript - please note there may be multiple sets of instructions.\n\n"
                    "###START TEMPLATE###\n"
                    f"{template.content}\n"
                    "###END TEMPLATE###\n\n"
                    "### STRICT RULES\n"
                    "1. **Do NOT** add or remove headings, colons, bullets, blank lines, or any other characters outside the [instructions].\n"
                    "2. If you feel there is not enough data to address the instruction, just include the instruction and a comment `I could not find enough data to answer this`.\n"
                    "3. Format all dates as MM/DD/YYYY.\n"
                    "4. Return the filled-in template **as plain text**. No code fences, no extra commentary, no word “markdown”."
                    "5. Do not include any other text or explanation. Do not include the <TEMPLATE> or </TEMPLATE> tags.\n"
                )
            },
            {
                "role": "user",
                "content": (
                    "### context\n"
                    f"{note_details}\n\n"
                    "### raw note\n"
                    f"{raw_note}"
                )
            }
        ],
        options={
            "temperature": 0.2,
        })["message"]["content"]


    print("Formatted markdown: " + formatted_markdown)
    
    return jsonify({
        "formatted_markdown": formatted_markdown
    })
    
import click
import uuid
from werkzeug.security import generate_password_hash
from getpass import getpass  # Import getpass for hidden password input

@app.cli.command("create-admin")
@click.option("--email", prompt=True, help="Admin email")
@click.option("--first-name", prompt=True, help="First name")
@click.option("--last-name", prompt=True, help="Last name")
def create_admin(email, first_name, last_name):
    """Create an admin user."""
    # Check if user exists
    if User.query.filter_by(email=email).first():
        click.echo(f"User with email {email} already exists.")
        return
    
    # Use getpass to hide password input
    password = getpass("Enter password (input will be hidden): ")
    password_confirm = getpass("Confirm password (input will be hidden): ")
    
    if password != password_confirm:
        click.echo("Passwords do not match!")
        return
        
    # Create new admin user
    admin_user = User(
        email=email,
        first_name=first_name,
        last_name=last_name,
        password=generate_password_hash(password, method='pbkdf2:sha256')
    )
    
    db.session.add(admin_user)
    db.session.commit()
    click.echo(f"Admin user created with ID: {admin_user.id}")
    
    
    
    
    
#RUN SERVER   
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)