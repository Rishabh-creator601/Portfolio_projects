from dotenv import load_dotenv

load_dotenv()


# change a value here to swap a pipeline component
config = {
    "chunking": "section_aware",   # or "recursive"
    "retriever": "hybrid",         # or "similarity"
    "prompt": "research",          # or "general"
    "collection": "client_xyz",
    "images": "off",               # "vision" (GPT reads figures) comes in the next version
}


CHAT_MODEL = "gpt-4o-mini"
EMBED_MODEL = "text-embedding-3-small"

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
TOP_K = 6                      # chunks sent to the LLM per question
MAX_SUMMARY_CHARS = 60000      # ~15k tokens of a paper sent for its summary

STORAGE_DIR = "storage"
