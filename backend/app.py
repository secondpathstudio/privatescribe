from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
from flask_jwt_extended import JWTManager, jwt_required, create_access_token, get_jwt_identity
import uuid
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from faster_whisper import WhisperModel
import ollama
import os
from pydub import AudioSegment
import io

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}})

# Secret key for JWT encoding/decoding
app.config['SECRET_KEY'] = 'aixodnglxuid8g93n2fn8g9d0sn2l0ggxyh3k1'  # Use a secure key in production

# SQLite Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///notes.db'  # SQLite database
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# JWT Manager
jwt = JWTManager(app)

# Load Faster-Whisper Model
model_size = "large-v3"
device = "cpu"
compute_type = "int8"
whisper_model = WhisperModel(
    "base",
    device=device,
    compute_type=compute_type
)

# User model (for authentication)
class User(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))  # UUID as primary key
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    createdAt = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship: A user has many notes
    notes = db.relationship('Note', backref='user', lazy=True, cascade='all, delete-orphan')

    def __repr__(self):
        return f"<User {self.username}>"

# Note model
class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    createdAt = db.Column(db.DateTime, default=datetime.utcnow)
    updatedAt = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    rawNoteTranscript = db.Column(db.Text, nullable=False)
    formattedMarkdown = db.Column(db.Text, nullable=False)
    patientId = db.Column(db.Integer, nullable=False)
    visitType = db.Column(db.String(50), nullable=False)
    
    # Foreign key: Link the note to a user
    userId = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False) 

    def __repr__(self):
        return f"<Note {self.id}>"

# API route to create a new user (for authentication)
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()

    # Validate input data
    if not data.get('username') or not data.get('password'):
        return jsonify({"error": "Username and password are required"}), 400

    # Check if user already exists
    if User.query.filter_by(username=data['username']).first():
        return jsonify({"error": "User already exists"}), 400

    # Hash the password before saving
    hashed_password = generate_password_hash(data['password'], method='sha256')

    # Create new user with UUID id
    new_user = User(username=data['username'], password=hashed_password)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"message": "User created successfully"}), 201

# API route to authenticate and get JWT token
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()

    # Validate input data
    if not data.get('username') or not data.get('password'):
        return jsonify({"error": "Username and password are required"}), 400

    # Check if user exists
    user = User.query.filter_by(username=data['username']).first()

    # Validate password (using hashed password comparison)
    if user and check_password_hash(user.password, data['password']):
        # Create a new JWT token
        access_token = create_access_token(identity=user.id, fresh=True)
        return jsonify({"access_token": access_token})

    return jsonify({"error": "Invalid username or password"}), 401

# API route to create a note (requires authentication)
@app.route('/api/notes', methods=['POST'])
@jwt_required()
def create_note():
    data = request.get_json()

    # Validate required fields
    if not all(k in data for k in ('rawNoteTranscript', 'formattedMarkdown', 'patientId', 'visitType')):
        return jsonify({"error": "Missing required fields"}), 400

    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Create a new note instance
    new_note = Note(
        rawNoteTranscript=data['rawNoteTranscript'],
        formattedMarkdown=data['formattedMarkdown'],
        patientId=data['patientId'],
        visitType=data['visitType'],
        userId=current_user  # Link the note to the current user (UUID)
    )

    # Add the note to the database
    db.session.add(new_note)
    db.session.commit()

    return jsonify({
        "id": new_note.id,
        "createdAt": new_note.createdAt,
        "updatedAt": new_note.updatedAt,
        "rawNoteTranscript": new_note.rawNoteTranscript,
        "formattedMarkdown": new_note.formattedMarkdown,
        "patientId": new_note.patientId,
        "visitType": new_note.visitType,
        "userId": new_note.userId
    }), 201

# API route to get a single note by ID (requires authentication)
@app.route('/api/notes/<int:id>', methods=['GET'])
@jwt_required()
def get_note(id):
    note = Note.query.get(id)
    if not note:
        return jsonify({"error": "Note not found"}), 404

    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the note belongs to the current user
    if note.userId != current_user:
        return jsonify({"error": "Not authorized to access this note"}), 403

    return jsonify({
        "id": note.id,
        "createdAt": note.createdAt,
        "updatedAt": note.updatedAt,
        "rawNoteTranscript": note.rawNoteTranscript,
        "formattedMarkdown": note.formattedMarkdown,
        "patientId": note.patientId,
        "visitType": note.visitType,
        "userId": note.userId
    })

# API route to update a note by ID (requires authentication)
@app.route('/api/notes/<int:id>', methods=['PUT'])
@jwt_required()
def update_note(id):
    note = Note.query.get(id)
    if not note:
        return jsonify({"error": "Note not found"}), 404

    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the note belongs to the current user
    if note.userId != current_user:
        return jsonify({"error": "Not authorized to update this note"}), 403

    data = request.get_json()

    # Update note attributes if provided
    note.rawNoteTranscript = data.get('rawNoteTranscript', note.rawNoteTranscript)
    note.formattedMarkdown = data.get('formattedMarkdown', note.formattedMarkdown)
    note.patientId = data.get('patientId', note.patientId)
    note.visitType = data.get('visitType', note.visitType)

    # Commit the changes to the database
    db.session.commit()

    return jsonify({
        "id": note.id,
        "createdAt": note.createdAt,
        "updatedAt": note.updatedAt,
        "rawNoteTranscript": note.rawNoteTranscript,
        "formattedMarkdown": note.formattedMarkdown,
        "patientId": note.patientId,
        "visitType": note.visitType,
        "userId": note.userId
    })

# API route to get all notes for a specific userId (requires authentication)
@app.route('/api/notes/user/<string:userId>', methods=['GET'])
@jwt_required()
def get_notes_for_user(userId):
    # Get the current user from the JWT
    current_user = get_jwt_identity()

    # Ensure the user is authorized to access notes for the given userId
    if current_user != userId:
        return jsonify({"error": "Not authorized to access notes for this user"}), 403

    notes = Note.query.filter_by(userId=userId).all()
    if not notes:
        return jsonify({"error": "No notes found for this user"}), 404

    notes_list = [{
        "id": note.id,
        "createdAt": note.createdAt,
        "updatedAt": note.updatedAt,
        "rawNoteTranscript": note.rawNoteTranscript,
        "formattedMarkdown": note.formattedMarkdown,
        "patientId": note.patientId,
        "visitType": note.visitType,
        "userId": note.userId
    } for note in notes]

    return jsonify(notes_list)

    
# Function to convert audio to WAV format (if needed)
def convert_audio(audio_data, format):
    audio = AudioSegment.from_file(io.BytesIO(audio_data), format=format)
    wav_io = io.BytesIO()
    audio.export(wav_io, format="wav")
    wav_io.seek(0)
    return wav_io


@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    format = file.filename.split('.')[-1]

    # Convert audio to WAV if necessary
    audio_data = file.read()
    if format.lower() != "wav":
        audio_data = convert_audio(audio_data, format)
    else:
        audio_data = io.BytesIO(audio_data)

    # Transcribe audio using Faster-Whisper
    segments, _ = whisper_model.transcribe(audio_data, language="en")

    # Combine segments into a single transcript    
    transcript = " ".join(segment.text for segment in segments)

    return jsonify({
        "raw_transcript": transcript,
        # "formatted_markdown": formatted_markdown
    })

@app.route('/getMarkdown', methods=['POST'])
def getMarkdown():
    transcript = request.json['raw_transcript']
    visit_details = request.json['visit_details']
    
    print("Generating markdown: " + transcript)
    
    # Format transcript with Ollama LLM
    formatted_markdown = ollama.chat(model="llama3.2", messages=[
        {"role": "system", "content": "You are an expert medical note assistant. Take the provided text of a conversation between a doctor and a patient. Your task is to format this conversation into a structured medical note in Markdown format with sections like Visit Details, Chief Complaint, History of Present Illness, and Physical Exam. Be concise but complete, only return the formatted markdown without any extra labels or titles."},
        {"role": "user", "content": f"Here are the visit details: \n\n{visit_details}. Here is the transcript to format:\n\n{transcript}."}
    ])["message"]["content"]

    
    return jsonify({
        "formatted_markdown": formatted_markdown
    })
    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)