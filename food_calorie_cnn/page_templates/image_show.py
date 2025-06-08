import streamlit as st 
from PIL import Image 
import io,cv2
import numpy as np 
import pandas as pd
from track_ import detect_food_image



def show():
    
    st.title("YOLOV11 Junk Food Calorie detection (By Image)")
    holder  = st.empty()
    image_bytes = holder.file_uploader("Choose a PNG file", type=["png","jpg"])
    
    if image_bytes is not None:
        image =  Image.open(io.BytesIO(image_bytes.read()))
        (annotated_img,classes,length_objs) =  detect_food_image(image,to_rgb=False)
        st.info(f"{length_objs} Items Found")
        df =  pd.DataFrame(classes.items(),columns=["Object Detected","Confidence"])
        st.image(cv2.resize(annotated_img,(500,500)),channels="RGB")
        holder.empty()
        st.table(df)
    