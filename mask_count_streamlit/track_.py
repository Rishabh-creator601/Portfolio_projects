from ultralytics  import YOLO 
import pandas as pd 
import cv2
import matplotlib.pyplot as plt 
import numpy as np





model =  YOLO("./models/best.pt")
model_face = YOLO("./models/yolo11n.pt")
# detector = dlib.get_frontal_face_detector()
 


classes = ["mask","no-mask"]
class_list = model.names
class_list_faces =  model_face.names



def draw_rects(image,coordinates=[],color=(0, 255, 0),text_tuple=None):
    
    
    
    for rects in coordinates:
        x,y,w,h =  rects
        rect_image =cv2.rectangle(image,(x,y),(w,h),color, 2)
        if text_tuple :
            rect_image = cv2.putText(text_tuple)
    
    return rect_image


def map_df(df):
    coordinates = []
    for _, row in df.iterrows():
        x1, y1, x2, y2,class_id,conf= row.astype("int")
        class_name = class_list[class_id] 
        coordinates.append([x1, y1, x2, y2])
    
    lenght_df =  len(np.array(df.values))
    
    return (coordinates,lenght_df)
        
        


    


# def track_images(image_path, model, class_list):
#     coordinates = []
#     results = model.predict(image_path)[0].boxes.data.detach().cpu().numpy()
#     probs =  results.probs
#     df = pd.DataFrame(results).astype("float")
#     #
#     for _, row in df.iterrows():
#         x1, y1, x2, y2, class_id, conf = map(int, row)
#         class_name = class_list[class_id] 
#         coordinates.append([x1, y1, x2, y2])
    
#     return (df,coordinates,class_name,conf,probs)



### USING DLIB LIBARAY 

# def count_faces(image=None):
    
#     image = np.array(image.convert('RGB'))
#     count  = 0 
#     faces =  detector(image,1)
#     for face in faces:
#         count  +=1 
    
#     return count



def detect_video_masks(frame):
    results_faces = model_face.track(frame,stream=True)
    results =  model.track(frame,stream=True)
    
    
    
    for r in results_faces:  ## FOR PERSON 
        for box in r.boxes:
            
            x,y,w,h = box.xyxy[0]
            x, y, w, h = int(x), int(y), int(w), int(h)
            
            cls = int(box.cls[0])
            class_name =  class_list_faces[cls]
            
            if class_name == "person":
                frame = draw_rects(frame,[[x,y,w,h]],color=(0,0,255))  ## BLUE 
                
    for r in results:  ## FOR FACE MASK
        for box in r.boxes:
            
            x,y,w,h = box.xyxy[0]
            x, y, w, h = int(x), int(y), int(w), int(h)
            
            cls = int(box.cls[0])
            frame = draw_rects(frame,[[x,y,w,h]],color=(0,255,0))  ## GREEN
                
            
            
    
    return frame
            

    



def detect_images_mask(image):
    
    image_copy_1 =  np.array(image.convert("RGB"))
    
    
    results = model.predict(image)[0].boxes.data.detach().cpu().numpy()
    df = pd.DataFrame(results).astype("float")   # for mask detection
    coordinates,mask_count  =  map_df(df)
    
    
    results_faces =  model_face.predict(image)[0].boxes.data.detach().cpu().numpy()
    df_faces = pd.DataFrame(results_faces).astype("float")   # for faces detection 
    coordinates_faces,face_Count = map_df(df_faces)
    
    
    
    image_rect =  draw_rects(image_copy_1,coordinates,color=(0,255,0)) ## RED FOR MASK
    image_rect =  draw_rects(image_copy_1,coordinates_faces,color=((0, 128, 255))) # LIGHT BLUE FOR FACE 
    
    # for face in faces :
    #     x,y,w,h = face.left(),face.top(),face.right(),face.bottom()
    #     image_rect = draw_rects(image_copy_1,coordinates=[[x,y,w,h]],color=(255,0,0))
    
    return (image_rect,mask_count,face_Count)
    
    
    

# (df,coordinates,class_name,conf,probs)  =  track_images("./media/one.jpg",model,class_list)

# print(df,probs)