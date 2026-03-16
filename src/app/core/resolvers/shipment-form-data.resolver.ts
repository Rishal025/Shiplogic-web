import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { map } from 'rxjs/operators';
import { SupplierService } from '../services/supplier.service';
import { Supplier } from '../models/supplier.model';

export interface ShipmentFormData {
  suppliers: Supplier[];
}

/**
 * Shipment Form Data Resolver
 * Loads Suppliers before rendering the create shipment page
 * Usage: Add to route config: resolve: { formData: shipmentFormDataResolver }
 */
export const shipmentFormDataResolver: ResolveFn<ShipmentFormData> = () => {
  const supplierService = inject(SupplierService);

  return supplierService.getAllSuppliers(1, 100).pipe(
    map(response => ({
      suppliers: response.suppliers
    }))
  );
};
