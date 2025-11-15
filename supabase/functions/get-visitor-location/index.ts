import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get IP from request headers
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const clientIp = forwardedFor?.split(',')[0] || realIp || 'unknown';
    
    console.log('Client IP:', clientIp);
    
    // Skip geolocation for localhost/private IPs
    if (clientIp === 'unknown' || clientIp.startsWith('192.168.') || clientIp.startsWith('10.') || clientIp === '127.0.0.1') {
      return new Response(
        JSON.stringify({
          ip: clientIp,
          country: 'Local',
          city: 'Local',
          region: 'Local',
          latitude: null,
          longitude: null,
          timezone: null,
          isp: null,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch geolocation data from ip-api.com (free, no API key needed)
    // Using all available fields for maximum detail
    const geoResponse = await fetch(
      `http://ip-api.com/json/${clientIp}?fields=status,country,countryCode,region,regionName,city,lat,lon,timezone,isp,query`
    );
    
    if (!geoResponse.ok) {
      throw new Error('Failed to fetch geolocation data');
    }

    const geoData = await geoResponse.json();
    
    console.log('Detailed geolocation data:', geoData);

    if (geoData.status === 'success') {
      return new Response(
        JSON.stringify({
          ip: geoData.query || clientIp,
          country: geoData.country || 'Unknown',
          city: geoData.city || 'Unknown',
          region: geoData.regionName || null,
          latitude: geoData.lat || null,
          longitude: geoData.lon || null,
          timezone: geoData.timezone || null,
          isp: geoData.isp || null,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          ip: clientIp,
          country: 'Unknown',
          city: 'Unknown',
          region: null,
          latitude: null,
          longitude: null,
          timezone: null,
          isp: null,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('Error in get-visitor-location:', error);
    
    return new Response(
      JSON.stringify({
        ip: 'unknown',
        country: 'Unknown',
        city: 'Unknown',
        region: null,
        latitude: null,
        longitude: null,
        timezone: null,
        isp: null,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200, // Return 200 even on error to not break the flow
      }
    );
  }
});
