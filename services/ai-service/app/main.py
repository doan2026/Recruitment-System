from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Recruitment AI Service", version="0.0.1")


class ChatRequest(BaseModel):
    session_id: str
    message: str


@app.get('/health')
def health() -> dict[str, str]:
    return {'service': 'ai-service', 'status': 'UP'}


@app.post('/chat')
def chat(_: ChatRequest) -> dict[str, str]:
    # TODO: hydrate short-lived Redis history and call Gemini with recruitment prompt.
    return {'message': 'AI chat service is ready for Gemini integration.'}

