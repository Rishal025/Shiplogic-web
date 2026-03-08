import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShipmentListComponent } from './components/shipment-list/shipment-list.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
    imports: [CommonModule, ShipmentListComponent],
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent { }
