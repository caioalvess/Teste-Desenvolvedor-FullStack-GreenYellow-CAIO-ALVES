import { Component } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { UploadComponent } from './upload/upload.component';
import { DashboardComponent } from './dashboard/dashboard.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ToolbarModule, UploadComponent, DashboardComponent],
  template: `
    <p-toolbar>
      <div class="p-toolbar-group-start">
        <span class="logo">GreenYellow • CSV Metrics</span>
      </div>
    </p-toolbar>

    <main class="container">
      <app-upload (uploaded)="onUploaded()" />
      <app-dashboard />
    </main>
  `,
  styles: [
    `
      .logo {
        font-weight: 600;
        font-size: 1.15rem;
      }
      .container {
        max-width: 1100px;
        margin: 1.5rem auto;
        padding: 0 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }
    `,
  ],
})
export class AppComponent {
  onUploaded() {
    // hook pro futuro: mostrar toast, refresh etc.
  }
}
