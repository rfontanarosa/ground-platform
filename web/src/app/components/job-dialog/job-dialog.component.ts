/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { DialogService } from '../../services/dialog/dialog.service';
import { Job } from '../../shared/models/job.model';
import { Task } from '../../shared/models/task/task.model';
import { Subscription } from 'rxjs';
import { FieldType, Field } from '../../shared/models/task/field.model';
import { StringMap } from '../../shared/models/string-map.model';
import { List } from 'immutable';
import { MarkerColorEvent } from '../edit-style-button/edit-style-button.component';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { JobService } from '../../services/job/job.service';
import { TaskFieldEditorComponent } from '../task-field-editor/task-field-editor.component';
import { NavigationService } from '../../services/navigation/navigation.service';

// To make ESLint happy:
/*global alert*/

@Component({
  selector: 'app-job-dialog',
  templateUrl: './job-dialog.component.html',
  styleUrls: ['./job-dialog.component.scss'],
})
export class JobDialogComponent implements OnDestroy {
  lang: string;
  job?: Job;
  jobName!: string;
  surveyId?: string;
  subscription: Subscription = new Subscription();
  fieldTypes = FieldType;
  fields: List<Field>;
  color!: string;
  defaultJobColor: string;
  task?: Task;
  @ViewChildren(TaskFieldEditorComponent)
  taskFieldEditors?: QueryList<TaskFieldEditorComponent>;
  contributorsCanAddPoints = true;
  contributorsCanAddPolygons = true;

  constructor(
    @Inject(MAT_DIALOG_DATA)
    data: {
      surveyId: string;
      job?: Job;
      createJob: boolean;
    },
    private dialogRef: MatDialogRef<JobDialogComponent>,
    private dialogService: DialogService,
    private jobService: JobService,
    private navigationService: NavigationService,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.lang = 'en';
    this.defaultJobColor = '#ff9131';
    // Disable closing on clicks outside of dialog.
    dialogRef.disableClose = true;
    this.fields = List<Field>();
    this.init(data.surveyId, data.createJob, data.job);
    this.dialogRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') {
        this.close();
      }
    });
  }

  addQuestion() {
    const newField = this.jobService.createField(
      FieldType.TEXT,
      /* label= */
      '',
      /* required= */
      false,
      /* index= */
      this.fields.size
    );
    this.fields = this.fields.push(newField);
    this.markTaskFieldsTouched();
    this.focusNewQuestion();
  }

  /**
   * Delete the field of a given index.
   *
   * @param index - The index of the field
   * @returns void
   *
   */
  onFieldDelete(index: number) {
    this.dialogService
      .openConfirmationDialog(
        'Warning',
        'Are you sure you wish to delete this question? Any associated data ' +
          'will be lost. This cannot be undone.'
      )
      .afterClosed()
      .subscribe(dialogResult => {
        if (dialogResult) {
          this.fields = this.fields.splice(index, 1);
        }
      });
  }

  init(surveyId: string, createJob: boolean, job?: Job) {
    if (!createJob && !job) {
      console.warn('User passed an invalid job id');
    }
    this.surveyId = surveyId;
    this.job = job;
    this.jobName = this.job?.name?.get(this.lang) || '';
    this.color = this.job?.color || this.defaultJobColor;
    if (!job) {
      this.job = this.jobService.createNewJob();
      this.addQuestion();
      return;
    }
    this.contributorsCanAddPoints =
      this.job?.contributorsCanAdd?.includes('points') || false;
    this.contributorsCanAddPolygons =
      this.job?.contributorsCanAdd?.includes('polygons') || false;
    this.task = this.jobService.getTask(this.job);
    if (this.task) {
      this.fields =
        this.task?.fields.toList().sortBy(field => field.index) ||
        List<Field>();
    } else {
      this.addQuestion();
    }
  }

  async onSave() {
    if (!this.surveyId) {
      throw Error('Survey not yet loaded');
    }

    if (!this.taskFieldEditors) {
      return;
    }

    this.markTaskFieldsTouched();

    for (const editor of this.taskFieldEditors) {
      if (editor.taskGroup.invalid || !this.isFieldOptionsValid(editor)) {
        return;
      }
    }
    const fields = this.jobService.convertFieldsListToMap(this.fields);
    const taskId = this.task?.id;
    const tasks = this.jobService.createTask(taskId, fields);
    const allowedFeatureTypes: string[] = [];
    if (this.contributorsCanAddPoints) {
      allowedFeatureTypes.push('points');
    }
    if (this.contributorsCanAddPolygons) {
      allowedFeatureTypes.push('polygons');
    }
    const job = new Job(
      this.job?.id || '',
      /* index */ this.job?.index || -1,
      this.color,
      // TODO: Make jobName Map
      StringMap({ [this.lang]: this.jobName.trim() }),
      tasks,
      allowedFeatureTypes
    );
    this.addOrUpdateJob(this.surveyId, job);
  }

  private isFieldOptionsValid(
    taskFieldEditor: TaskFieldEditorComponent
  ): boolean {
    if (!taskFieldEditor.optionEditors) {
      return true;
    }
    for (const editor of taskFieldEditor.optionEditors) {
      if (editor.optionGroup.invalid) {
        return false;
      }
    }
    return true;
  }

  private addOrUpdateJob(surveyId: string, job: Job) {
    // TODO: Inform user job was saved
    this.jobService
      .addOrUpdateJob(surveyId, job)
      .then(() => this.close())
      .catch(err => {
        console.error(err);
        alert('Job update failed.');
      });
  }

  onCancel(): void {
    if (!this.hasUnsavedChanges()) {
      this.close();
      return;
    }
    this.dialogService
      .openConfirmationDialog(
        'Discard changes',
        'Unsaved changes to this job will be lost. Are you sure?',
        /* showDiscardActions= */ true
      )
      .afterClosed()
      .subscribe(async dialogResult => {
        if (dialogResult) {
          this.close();
        }
      });
  }

  setJobName(value: string) {
    this.jobName = value;
  }

  /**
   * Updates the field at given index from event emitted from task-field-editor
   *
   * @param index - The index of the field
   * @param event - updated field emitted from task-field-editor
   * @returns void
   *
   */
  onFieldUpdate(event: Field, index: number) {
    const fieldId = this.fields.get(index)?.id;
    const field = new Field(
      fieldId || '',
      event.type,
      event.label,
      event.required,
      index,
      event.multipleChoice
    );
    this.fields = this.fields.set(index, field);
  }

  trackByFn(index: number) {
    return index;
  }

  drop(event: CdkDragDrop<string[]>) {
    const fieldAtPrevIndex = this.fields.get(event.previousIndex);
    if (!fieldAtPrevIndex) {
      return;
    }
    this.fields = this.fields.delete(event.previousIndex);
    this.fields = this.fields.insert(event.currentIndex, fieldAtPrevIndex);
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  onMarkerColorChange(event: MarkerColorEvent) {
    this.color = event.color;
  }

  private markTaskFieldsTouched(): void {
    this.taskFieldEditors?.forEach(editor => {
      this.markOptionsTouched(editor);
      editor.labelControl.markAsTouched();
    });
  }

  private markOptionsTouched(editor: TaskFieldEditorComponent): void {
    editor.optionEditors?.forEach(editor => {
      editor.optionGroup.markAllAsTouched();
    });
  }

  private focusNewQuestion(): void {
    if (this.taskFieldEditors?.length) {
      this.cdr.detectChanges();
      const question = this.taskFieldEditors.last;
      question?.questionInput?.nativeElement.focus();
    }
  }

  private isFieldOptionsDirty(
    taskFieldEditor: TaskFieldEditorComponent
  ): boolean {
    if (!taskFieldEditor.optionEditors) {
      return true;
    }
    for (const editor of taskFieldEditor.optionEditors) {
      if (editor.optionGroup.dirty) {
        return false;
      }
    }
    return true;
  }

  private hasUnsavedChanges(): boolean {
    if (!this.taskFieldEditors) {
      return false;
    }
    for (const editor of this.taskFieldEditors) {
      if (editor.taskGroup.dirty || !this.isFieldOptionsDirty(editor)) {
        return true;
      }
    }
    return false;
  }

  private close(): void {
    this.dialogRef.close();
    // TODO: Add closeJobDialog() in NavigationService that removes the job fragment.
    return this.navigationService.selectSurvey(this.surveyId!);
  }
}