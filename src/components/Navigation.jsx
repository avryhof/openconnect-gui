import { useRef } from 'react';
import { Network, ScrollText, Activity, ListChecks, Settings } from 'lucide-react';
import { Badge } from './ui/badge';

function Navigation({ currentView, onViewChange, problematicRoutesCount, runningProcessesCount }) {
  const tabRefs = useRef({});
  const navItems = [
    { id: 'connection', label: 'Connection', icon: Network },
    { id: 'logs', label: 'Logs', icon: ScrollText },
    { id: 'diagnostics', label: 'Diagnostics', icon: Activity, badge: problematicRoutesCount },
    { id: 'processes', label: 'Processes', icon: ListChecks, badge: runningProcessesCount },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleKeyDown = (e, index) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) {
      return;
    }
    e.preventDefault();
    let nextIndex = index;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % navItems.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + navItems.length) % navItems.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = navItems.length - 1;
    }
    const nextTab = navItems[nextIndex];
    onViewChange(nextTab.id);
    const node = tabRefs.current[nextTab.id];
    if (node) {
      node.focus();
    }
  };

  return (
    <nav className="border-b bg-muted/30">
      <div className="px-6 flex gap-1" role="tablist" aria-label="Main sections">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              ref={(node) => { tabRefs.current[item.id] = node; }}
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${item.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onViewChange(item.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`
                flex items-center gap-2 px-4 py-3 border-b-2 transition-colors rounded-t
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                ${isActive
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }
              `}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
              {item.badge > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                  {item.badge}
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default Navigation;
