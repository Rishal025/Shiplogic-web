import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  DashboardArrivalSummary,
  DashboardMonthlyTrend,
  DashboardStageBreakdown,
  DashboardSummaryResponse,
} from '../../core/models/shipment.model';
import { DashboardService } from './services/dashboard.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  private dashboardService = inject(DashboardService);

  dashboard = signal<DashboardSummaryResponse | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  readonly statCards = computed(() => {
    const summary = this.dashboard();
    if (!summary) return [];

    return [
      {
        label: 'Total Shipments',
        value: summary.kpis.totalShipments,
        tone: 'slate',
        icon: 'pi pi-box'
      },
      {
        label: 'Completed',
        value: summary.kpis.completedShipments,
        tone: 'emerald',
        icon: 'pi pi-check-circle'
      },
      {
        label: 'In Progress',
        value: summary.kpis.inProgressShipments,
        tone: 'blue',
        icon: 'pi pi-sync'
      },
      {
        label: 'Under Clearance',
        value: summary.kpis.underClearanceShipments,
        tone: 'amber',
        icon: 'pi pi-globe'
      }
    ];
  });

  readonly arrivalMetrics = computed(() => {
    const arrival = this.dashboard()?.arrivalSummary;
    if (!arrival) return [];

    return [
      { label: 'Arrived Containers', value: arrival.arrivedContainers, tone: 'emerald' },
      { label: 'Pending Arrival', value: arrival.pendingArrivalContainers, tone: 'blue' },
      { label: 'Due This Week', value: arrival.dueThisWeekShipments, tone: 'amber' },
      { label: 'Overdue ETA', value: arrival.overdueShipments, tone: 'rose' }
    ];
  });

  readonly stageMax = computed(() =>
    Math.max(...(this.dashboard()?.stageBreakdown ?? []).map((item) => item.count), 0)
  );

  readonly monthlyMax = computed(() =>
    Math.max(...(this.dashboard()?.monthlyTrend ?? []).map((item) => item.count), 0)
  );

  ngOnInit(): void {
    this.dashboardService.getSummary().subscribe({
      next: (summary) => {
        this.dashboard.set(summary);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Unable to load dashboard data right now.');
        this.loading.set(false);
      }
    });
  }

  getStageWidth(entry: DashboardStageBreakdown): string {
    const max = this.stageMax();
    if (!max) return '0%';
    return `${Math.max((entry.count / max) * 100, 8)}%`;
  }

  getTrendHeight(entry: DashboardMonthlyTrend): string {
    const max = this.monthlyMax();
    if (!max) return '12%';
    return `${Math.max((entry.count / max) * 100, 12)}%`;
  }

  getArrivalWidth(value: number, summary: DashboardArrivalSummary | undefined): string {
    const total = summary
      ? Math.max(
          summary.arrivedContainers,
          summary.pendingArrivalContainers,
          summary.dueThisWeekShipments,
          summary.overdueShipments,
          1
        )
      : 1;

    return `${Math.max((value / total) * 100, 10)}%`;
  }
}
