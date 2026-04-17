import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Step {
  label: string;
  subLabel?: string;
  icon?: string;
  completed?: boolean;
}

@Component({
  selector: 'app-stepper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stepper.component.html',
  styleUrls: ['./stepper.component.scss']
})
export class StepperComponent {
  @Input() steps: Step[] = [];
  @Input() currentStep = 0;
  /** When set, steps with index > maxEnabledStep are rendered disabled and cannot be clicked. */
  @Input() maxEnabledStep: number | null = null;
  @Output() stepChange = new EventEmitter<number>();

  onStepClick(index: number) {
    if (this.maxEnabledStep != null && index > this.maxEnabledStep) {
      return;
    }
    this.stepChange.emit(index);
  }
}
