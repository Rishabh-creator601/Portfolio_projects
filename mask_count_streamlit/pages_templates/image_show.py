import streamlit as st 
from PIL import Image
import cv2 ,io
from track_ import detect_images_mask





def show():
    
    st.title("Mask Detection In Image Files ")
    
    

    holder  = st.empty()
    image_bytes = holder.file_uploader("Choose a PNG file", type=["png","jpg"])
    
    if image_bytes is not None:
        image =  Image.open(io.BytesIO(image_bytes.read()))
        detected_faces,mask_count,count =  detect_images_mask(image)
        st.image(detected_faces)
        st.info(f"NO OF FACES(CLEAR) DETECTETD : {count}")
        st.success(f"NO OF FACE WITH MASK DETECTETD : {mask_count}")
        holder.empty()
       

    