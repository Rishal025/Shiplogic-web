import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { selectUser, selectUserName, selectUserRole } from '../../../store/auth/auth.selectors';
import { logout } from '../../../store/auth/auth.actions';
import { User } from '../../../core/services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class NavbarComponent {
  private store = inject(Store);
  
  user$: Observable<User | null> = this.store.select(selectUser);
  userName$: Observable<string | undefined> = this.store.select(selectUserName);
  userRole$: Observable<string | undefined> = this.store.select(selectUserRole);

  onLogout(): void {
    this.store.dispatch(logout());
  }
}
