import streamlit as st




st.markdown("""
# 🌸 Flower Detection Project (YOLOv8)

## 📌 Project Overview
This project builds a **custom object detection model** using **YOLOv8** to detect different flower species.  
The objective was to train and evaluate a model capable of **identifying and localizing flowers** in images with balanced performance across classes.

### Flower Categories (5 Classes)
- 🌼 **Lilly**  
- 🌺 **Lotus**  
- 🌸 **Orchid**  
- 🌻 **Sunflower**  
- 🌷 **Tulip**

---

## 🛠️ Dataset Details
- **Total classes:** 5  
- **Objects per class (approx.):**
  - Lilly → 33  
  - Lotus → 54  
  - Orchid → 37  
  - Sunflower → 36  
  - Tulip → 30  

🔹 The dataset is fairly balanced, though **Tulip and Orchid** posed challenges due to class similarity and annotation variations.

---

## ⚙️ Training Configuration
- **Framework:** Ultralytics YOLOv8 (PyTorch backend)  
- **Task:** Object Detection (`detect`)  
- **Epochs:** Multiple experiments with varied ranges  
- **Image Size:** Default (internally resized)  
- **Save Directory:** `/kaggle/working/runs/detect/`  

---

## 📊 Results Summary

### ✅ Overall Metrics
- **Precision:** 0.599  
- **Recall:** 0.573  
- **mAP@50:** 0.599  
- **mAP@50-95:** 0.348  

➡️ The model performs well at **mAP@50**, but stricter IoU thresholds reveal difficulties in precise localization.

---

### 📈 Per-Class Performance

| Class      | Precision | Recall | mAP@50 | mAP@50-95 |
|------------|-----------|--------|--------|-----------|
| 🌼 Lilly   | 0.681     | 0.517  | 0.638  | 0.370     |
| 🌺 Lotus   | 0.789     | 0.759  | 0.785  | 0.456     |
| 🌸 Orchid  | 0.799     | 0.429  | 0.524  | 0.298     |
| 🌻 Sunflower | 0.411   | 0.694  | 0.670  | 0.423     |
| 🌷 Tulip   | 0.313     | 0.467  | 0.379  | 0.192     |

---

## 🔍 Key Insights
- 🌺 **Lotus** → Best-performing class with balanced precision & recall.  
- 🌻 **Sunflower** → High recall but low precision (model tends to over-detect → false positives).  
- 🌸 **Orchid** → High precision but low recall (misses many orchids, but detected ones are accurate).  
- 🌷 **Tulip** → Weakest across all metrics, likely due to class similarity & limited diversity.  
- 🌼 **Lilly** → Mid-range performance, could benefit from more data.  

---

## ⚡ Speed Performance
- **Preprocessing:** ~1.3–2.5 ms per image  
- **Inference:** ~4.9–5.0 ms per image  
- **Postprocessing:** ~0.9–1.5 ms per image  

🚀 The model is **lightweight, fast, and suitable for real-time applications**.
""")
