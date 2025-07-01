# Private AI Scribe

An open-source private AI scribe application using Flask for the backend, SQLite for the database, Vite for the frontend, and Ollama for local AI inference.

---

## Tech Stack

* **Backend**: Flask, SQLAlchemy, SQLite
* **Frontend**: Vite
* **AI Model Inference**: Ollama (defaulting to the Llama 3.2 model)

---

## Prerequisites

Make sure you have the following installed on your machine:

* Python 3.8+
* Node.js 16+
* npm
* [Ollama](https://ollama.ai/) (installed and running locally)

---

## Installation

### Clone the Repository

```bash
git clone https://github.com/yourusername/private-ai-scribe.git
cd private-ai-scribe
```

### Backend Setup

Create a virtual environment and install Python dependencies:

```bash
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
pip install -r requirements.txt
```

Initialize the SQLite database:

```bash
flask db upgrade  # if using migrations, otherwise your custom init command
```

### Frontend Setup

Navigate to the frontend directory and install dependencies:

```bash
cd frontend
npm install
```

---

## Running the Application

### Start Backend (Flask)

From the project root:

```bash
source venv/bin/activate
flask run
```

Your backend will start at `http://127.0.0.1:5000`

### Start Frontend (Vite)

From the frontend directory:

```bash
npm run dev
```

The frontend will be available at `http://127.0.0.1:5173`

---

## Ollama Setup

Ensure Ollama is installed and running:

```bash
ollama serve
```

Download the default Llama 3.2 model:

```bash
ollama pull llama:3.2
```

You can test the model locally with:

```bash
ollama run llama:3.2
```

Make sure to configure your Flask backend to connect to the local Ollama API.

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
