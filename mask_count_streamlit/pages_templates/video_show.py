import streamlit as st 
import tempfile
import cv2 
from track_ import detect_video_masks




def show():
    
    st.title("Mask Detection In Video  Files ")
    
    
    holder  = st.empty()
    video_bytes = holder.file_uploader("Choose a Video file", type=["mp4", "mov", "avi", "mkv"])
    
    if video_bytes  is not None:
        holder.empty()

        tfile =  tempfile.NamedTemporaryFile(delete=False)
        tfile.write(video_bytes.read())
        
        
        cap =  cv2.VideoCapture(tfile.name)
        empty_frame= st.empty()
        
        while cap.isOpened() :
            ret,frame = cap.read()
            
            frame =  detect_video_masks(frame)
            
            if not ret :
                #st.error("Cant Read Video File")
                break
            empty_frame.image(frame,channels="RGB")
        cap.release()
        
       
        