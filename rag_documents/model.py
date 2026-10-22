import json
import os
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from config import CHAT_MODEL, TOP_K, MAX_SUMMARY_CHARS, STORAGE_DIR
from prompts import QA_PROMPTS, SUMMARY
from retriever import retrieve


llm = ChatOpenAI(model=CHAT_MODEL, temperature=0)


class PaperSummary(BaseModel):
    title: str = Field(description="Full title of the paper")
    problem: str = Field(description="Research problem or question the paper addresses")
    method: str = Field(description="Proposed method, model or approach")
    dataset: str = Field(description="Datasets or data used")
    results: str = Field(description="Main results, with numbers where given")
    limitations: str = Field(description="Limitations stated by the authors or clearly implied")


SUMMARY_FIELDS = ["title", "problem", "method", "dataset", "results", "limitations"]


# ---------- Q&A ----------

def format_context(docs):
    parts = []
    for d in docs:
        m = d.metadata
        section = f" ({m['section']})" if m.get("section") else ""
        parts.append(f"[{m['paper']}, {m['loc']}]{section}\n{d.page_content}")
    return "\n\n---\n\n".join(parts)


def ask(store, question, cfg, papers=None):
    docs = retrieve(store, question, TOP_K, cfg["retriever"], papers)
    if not docs:
        return "No papers in the library yet. Upload some in the Library tab.", []
    prompt = QA_PROMPTS[cfg["prompt"]].format(context=format_context(docs), question=question)
    return llm.invoke(prompt).content, docs


# ---------- summaries (saved per collection so each paper is paid for once) ----------

def summary_file(collection):
    return f"{STORAGE_DIR}/summaries_{collection}.json"


def load_summaries(collection):
    path = summary_file(collection)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_summaries(collection, summaries):
    os.makedirs(STORAGE_DIR, exist_ok=True)
    with open(summary_file(collection), "w", encoding="utf-8") as f:
        json.dump(summaries, f, indent=2, ensure_ascii=False)


def summarize(paper, text):
    prompt = SUMMARY.format(paper=paper, text=text[:MAX_SUMMARY_CHARS])
    result = llm.with_structured_output(PaperSummary).invoke(prompt)
    return result.model_dump()
