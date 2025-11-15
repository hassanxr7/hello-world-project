import { useEffect } from "react";
import { trackVisitor } from "@/utils/visitorTracking";

const VisitorTracker = () => {
  useEffect(() => {
    // Track on mount
    trackVisitor();
    
    // Track on page visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        trackVisitor();
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
  
  return null;
};

export default VisitorTracker;
