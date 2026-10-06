import { AlarmClock, CalendarDays, Dumbbell, MessageCircle, Receipt, Sun, type LucideIcon } from 'lucide-react';
import type { RepeatKind } from './scheduleForm';

export interface Preset {
  label: string;
  icon: LucideIcon;
  title: string;
  message_template: string;
  kind: RepeatKind;
  days?: number[]; // for kind 'weekly', 0 = Sunday
  send_time: string;
}

// {a|b|c} picks one variation at send time so recurring messages don't look robotic.
export const PRESETS: Preset[] = [
  {
    label: 'Good morning',
    icon: Sun,
    title: 'Good morning',
    message_template: '{Good morning|Morning|GM} {first_name}! {☀️|🌞|Have a great {day}!}',
    kind: 'daily',
    send_time: '08:00',
  },
  {
    label: 'Check in',
    icon: MessageCircle,
    title: 'Check in',
    message_template: '{Hey|Hi} {first_name}, {how’s your week going?|how have you been?|what’s new with you?}',
    kind: 'weekly',
    days: [0],
    send_time: '18:00',
  },
  {
    label: 'Weekend plans',
    icon: CalendarDays,
    title: 'Weekend plans',
    message_template: '{Free this weekend?|Any plans this weekend?|Want to hang out this weekend?}',
    kind: 'weekly',
    days: [5],
    send_time: '12:00',
  },
  {
    label: 'Bill reminder',
    icon: Receipt,
    title: 'Bill reminder',
    message_template: 'Hey {first_name}, reminder that bills are due. {Can you send your share?|Mind sending your part today?}',
    kind: 'monthly',
    send_time: '10:00',
  },
  {
    label: 'Workout invite',
    icon: Dumbbell,
    title: 'Workout invite',
    message_template: '{Gym at 2?|Working out today at 2?|Down for a workout at 2?}',
    kind: 'weekdays',
    send_time: '14:00',
  },
  {
    label: 'One-time reminder',
    icon: AlarmClock,
    title: 'Reminder',
    message_template: 'Hey {first_name}, just a reminder: ',
    kind: 'once',
    send_time: '09:00',
  },
];
