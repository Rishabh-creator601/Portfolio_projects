import streamlit as st
import os 
from PIL import Image




st.sidebar.title("Model Summary")


st.markdown("""

# 🔄 Flower Detection Pipeline

## **1. Data Preparation**
- Collect dataset of 5 flower classes: **Lilly, Lotus, Orchid, Sunflower, Tulip**.  
- Organize into **YOLO format**:  
  - `images/train`, `images/val`, `images/test`  
  - `labels/train`, `labels/val`, `labels/test`  
- Ensure annotations are consistent (`.txt` files with class + bounding boxes).  
- Verify class distribution to check balance.  

            
            
""")

image_paths = os.listdir("metrics")

num_cols = 2

# Display in columns
cols = st.columns(num_cols)

for idx, img_path in enumerate(image_paths):
    with cols[idx % num_cols]:
        st.image(Image.open(os.path.join("metrics",img_path)), use_container_width=True, caption=f"{img_path.split('.')[0]}")

