import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, ExternalLink, Globe } from "lucide-react";

interface PageView {
  id: string;
  page_url: string;
  page_title: string | null;
  time_spent_seconds: number;
  viewed_at: string;
}

interface VisitorDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitorId: string;
  pageViews: PageView[];
  referrer: string | null;
}

const VisitorDetailsDialog = ({
  open,
  onOpenChange,
  visitorId,
  pageViews,
  referrer,
}: VisitorDetailsDialogProps) => {
  const formatTimeSpent = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const getTotalTimeSpent = (): string => {
    const total = pageViews.reduce((sum, view) => sum + view.time_spent_seconds, 0);
    return formatTimeSpent(total);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Visitor Journey Details
            <span className="text-sm font-mono text-muted-foreground">
              {visitorId.substring(0, 25)}...
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Pages Visited</p>
              <p className="text-2xl font-bold">{pageViews.length}</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Total Time Spent</p>
              <p className="text-2xl font-bold">{getTotalTimeSpent()}</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Referrer</p>
              <p className="text-sm font-medium truncate" title={referrer || "Direct"}>
                {referrer ? new URL(referrer).hostname : "Direct"}
              </p>
            </div>
          </div>

          {/* Referrer Info */}
          {referrer && (
            <div className="flex items-start gap-2 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <Globe className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Came from:</p>
                <a 
                  href={referrer} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  {referrer}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {/* Page Visit History */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Page Visit History
            </h3>
            {pageViews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No page views recorded yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead>Time Spent</TableHead>
                    <TableHead>Visited At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageViews.map((view) => (
                    <TableRow key={view.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-sm">
                            {view.page_title || "Untitled Page"}
                          </span>
                          <a
                            href={view.page_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-primary truncate max-w-md flex items-center gap-1"
                          >
                            {view.page_url}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {formatTimeSpent(view.time_spent_seconds)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(view.viewed_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VisitorDetailsDialog;
