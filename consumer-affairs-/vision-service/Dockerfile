FROM python:3.11-slim

# OpenCV needs these even in the headless build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install an OCR engine by passing --build-arg OCR_ENGINE=paddleocr|easyocr.
# With neither, the service still runs and falls back to a deterministic stub
# that flags every reading for officer review.
ARG OCR_ENGINE=none
RUN if [ "$OCR_ENGINE" = "paddleocr" ]; then \
      pip install --no-cache-dir paddlepaddle==2.6.1 paddleocr==2.8.1; \
    elif [ "$OCR_ENGINE" = "easyocr" ]; then \
      pip install --no-cache-dir easyocr==1.7.2; \
    fi

COPY main.py .
COPY app ./app
COPY benchmark ./benchmark
COPY tests ./tests

ENV OCR_ENGINE=${OCR_ENGINE}
ENV PYTHONUNBUFFERED=1

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8001/health', timeout=4).status==200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
