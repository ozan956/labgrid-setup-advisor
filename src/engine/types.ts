export type Answers = Record<string, string>;

export interface Predicate {
  question: string;
  equals?: string;
  in?: string[];
}

export interface Condition {
  all?: Predicate[];
  any?: Predicate[];
}

export interface AnswerOption {
  value: string;
  label: string;
  description: string;
}

export interface Question {
  id: string;
  text: string;
  help: string;
  visibleWhen?: Condition;
  options: AnswerOption[];
}

export interface ComponentRecommendation {
  kind: 'resource' | 'driver' | 'strategy' | 'infrastructure';
  name: string;
  reason: string;
}

export interface Recommendation {
  id: string;
  category: 'approach' | 'topology' | 'warning';
  title: string;
  summary: string;
  when: Condition;
  why: string[];
  requirements: {
    hardware: string[];
    software: string[];
  };
  components: ComponentRecommendation[];
  architecture: Array<{ label: string; detail: string }>;
  commands: Array<{ command: string; description: string }>;
  documentation: string[];
}

export interface ConfigurationTemplate {
  id: string;
  title: string;
  filename: string;
  kind: 'environment' | 'exporter';
  when: Condition;
  template: string;
  placeholders: Array<{
    token: string;
    label: string;
    description: string;
    example: string;
    required: boolean;
  }>;
}

export interface DocumentationReference {
  id: string;
  title: string;
  url: string;
}

export interface UseCaseDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  questions: Question[];
  recommendations: Recommendation[];
  configurations: ConfigurationTemplate[];
  documentation: DocumentationReference[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

