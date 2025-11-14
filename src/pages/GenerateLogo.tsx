import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Sparkles } from "lucide-react";

const GenerateLogo = () => {
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const generateLogo = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-logo');
      
      if (error) throw error;
      
      if (data.success && data.imageUrl) {
        setLogoUrl(data.imageUrl);
        toast.success("Logo generated successfully!");
      } else {
        throw new Error(data.error || "Failed to generate logo");
      }
    } catch (error: any) {
      console.error('Error:', error);
      toast.error(error.message || "Failed to generate logo");
    } finally {
      setLoading(false);
    }
  };

  const downloadLogo = () => {
    if (!logoUrl) return;
    
    const link = document.createElement('a');
    link.href = logoUrl;
    link.download = 'hubdexpay-logo-new.png';
    link.click();
    toast.success("Logo downloaded!");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Generate New Logo
          </CardTitle>
          <CardDescription>
            Generate a modern logo for HubdexPay using AI
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button 
            onClick={generateLogo} 
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? "Generating..." : "Generate Logo"}
          </Button>

          {logoUrl && (
            <div className="space-y-4">
              <div className="border rounded-lg p-4 bg-white">
                <img 
                  src={logoUrl} 
                  alt="Generated Logo" 
                  className="w-full h-auto max-h-96 object-contain"
                />
              </div>
              <Button 
                onClick={downloadLogo}
                variant="outline"
                className="w-full"
              >
                <Download className="w-4 h-4 mr-2" />
                Download Logo
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GenerateLogo;
