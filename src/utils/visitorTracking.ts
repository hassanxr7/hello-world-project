import { supabase } from "@/integrations/supabase/client";

// Generate or retrieve visitor ID from cookies
export const getVisitorId = (): string => {
  const cookieName = "hubdexpay_visitor_id";
  const cookies = document.cookie.split(";");
  
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === cookieName) {
      return value;
    }
  }
  
  // Generate new visitor ID
  const newVisitorId = `visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Set cookie for 1 year
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  document.cookie = `${cookieName}=${newVisitorId}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;
  
  return newVisitorId;
};

// Detect if visitor is a bot
export const detectBot = (): { isBot: boolean; botName: string | null } => {
  const userAgent = navigator.userAgent.toLowerCase();
  
  const botPatterns = [
    { pattern: /googlebot/i, name: "Googlebot" },
    { pattern: /bingbot/i, name: "Bingbot" },
    { pattern: /slurp/i, name: "Yahoo Slurp" },
    { pattern: /duckduckbot/i, name: "DuckDuckBot" },
    { pattern: /baiduspider/i, name: "Baidu Spider" },
    { pattern: /yandexbot/i, name: "YandexBot" },
    { pattern: /facebookexternalhit/i, name: "Facebook Bot" },
    { pattern: /twitterbot/i, name: "Twitter Bot" },
    { pattern: /linkedinbot/i, name: "LinkedIn Bot" },
    { pattern: /whatsapp/i, name: "WhatsApp Bot" },
    { pattern: /telegrambot/i, name: "Telegram Bot" },
    { pattern: /bot|crawler|spider|scraper/i, name: "Generic Bot" },
  ];
  
  for (const { pattern, name } of botPatterns) {
    if (pattern.test(userAgent)) {
      return { isBot: true, botName: name };
    }
  }
  
  return { isBot: false, botName: null };
};

// Get device type
export const getDeviceType = (): string => {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return "tablet";
  }
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return "mobile";
  }
  return "desktop";
};

// Track visitor
export const trackVisitor = async () => {
  try {
    const visitorId = getVisitorId();
    const { isBot, botName } = detectBot();
    const deviceType = getDeviceType();
    
    // Get geolocation data
    let ipAddress = null;
    let country = null;
    let city = null;
    
    try {
      const locationResponse = await supabase.functions.invoke('get-visitor-location', {
        body: {}
      });
      
      if (locationResponse.data) {
        ipAddress = locationResponse.data.ip;
        country = locationResponse.data.country;
        city = locationResponse.data.city;
      }
    } catch (error) {
      console.error('Error fetching location:', error);
    }
    
    const trackingData = {
      visitor_id: visitorId,
      page_url: window.location.href,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      ip_address: ipAddress,
      country: country,
      city: city,
      device_type: deviceType,
      is_bot: isBot,
      bot_name: botName,
      last_active: new Date().toISOString(),
    };
    
    // Check if visitor exists
    const { data: existingVisitor } = await supabase
      .from("visitor_tracking")
      .select("id, pages_visited")
      .eq("visitor_id", visitorId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (existingVisitor) {
      // Update existing visitor
      await supabase
        .from("visitor_tracking")
        .update({
          page_url: trackingData.page_url,
          pages_visited: (existingVisitor.pages_visited || 0) + 1,
          last_active: trackingData.last_active,
        })
        .eq("id", existingVisitor.id);
    } else {
      // Insert new visitor
      await supabase
        .from("visitor_tracking")
        .insert(trackingData);
    }
  } catch (error) {
    console.error("Error tracking visitor:", error);
  }
};
