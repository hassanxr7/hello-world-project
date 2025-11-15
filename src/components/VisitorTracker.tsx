import { useEffect } from "react";
import { trackVisitor, updatePageTimeSpent, getVisitorId } from "@/utils/visitorTracking";

const VisitorTracker = () => {
  useEffect(() => {
    const visitorId = getVisitorId();
    
    // Track on mount
    trackVisitor();
    
    // Track on page visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        trackVisitor();
      } else {
        // Update time spent when leaving page
        updatePageTimeSpent(visitorId);
      }
    };
    
    // Update time spent before page unload
    const handleBeforeUnload = () => {
      updatePageTimeSpent(visitorId);
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    
    // Update time spent every 30 seconds while active
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        updatePageTimeSpent(visitorId);
      }
    }, 30000);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearInterval(interval);
      updatePageTimeSpent(visitorId);
    };
  }, []);
  
  return null;
};

export default VisitorTracker;
