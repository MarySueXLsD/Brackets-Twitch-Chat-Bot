// Choosing what to answer is a job of its own, done before any reply is written: the model is
// shown the latest messages and asked which one can be answered in general terms, knowing nothing.
// Questions that need facts are left alone, so nothing has to be made up later.
import type { Lang, Role } from '../shared/types.ts'

export interface PickPrompt {
  system: string
  user: string
}

const flat = (text: string, max = 180): string => {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

const RU: Record<Role, string[]> = {
  // Your own channel: the viewers are talking to you.
  creator: [
    'Ты помогаешь стримеру выбрать, на какое сообщение зрителя в его чате ответить.',
    'Подходит только сообщение, на которое стример может ответить в общих словах, ничего не уточняя: похвала стриму или стримеру («классный стрим», «ты лучший»), приветствие или прощание, общий вопрос к стримеру или к чату («как дела?», «как настроение?»), шутка или настроение, которое можно поддержать.',
    'Не подходит: вопрос, для ответа на который нужны факты (про игру, железо, расписание, цифры, имена, ссылки, то, что сейчас происходит на стриме); просьба что-то сделать, дать, пообещать или кого-то наказать; спор или ссора; политика, оскорбления, мат, 18+; сообщение другому зрителю; крик, спам, бессмыслица.',
    'Из подходящих сначала выбирай похвалу и приветствия: на них стример отвечает охотнее всего.'
  ],
  // Someone else's channel: you are one of the viewers.
  viewer: [
    'Ты выбираешь, на какое сообщение из чата Twitch стоит ответить обычному зрителю.',
    'Подходит только сообщение, на которое можно ответить в общих словах, ничего не зная: общий вопрос ко всему чату («как дела, чат?», «что думаете?», «кто откуда смотрит?»), просьба о мнении, приветствие или прощание со всеми, либо мнение или настроение, с которым можно просто согласиться («уютный стрим», «спать хочу»).',
    'Не подходит: вопрос, для ответа на который нужны факты (про стримера, игру, технику, цифры, время, имена, ссылки); реакция на то, что прямо сейчас происходит на стриме (событие, счёт, счётчик, момент в игре), потому что ты этого не видишь; просьба о помощи; спор или ссора; политика, оскорбления, мат, 18+; сообщение конкретному человеку; крик, спам, бессмыслица.',
    'Из подходящих выбирай общий вопрос, если он есть.'
  ]
}

const EN: Record<Role, string[]> = {
  creator: [
    'You help a streamer choose which viewer message in their chat to answer.',
    'Only a message the streamer can answer in general terms, without checking anything, is a good one: praise for the stream or the streamer ("great stream", "you are the best"), a hello or a goodbye, a general question to the streamer or the chat ("how are you?", "how is it going?"), a joke or a mood one can join in.',
    'A bad one: a question that needs facts to answer (about the game, hardware, the schedule, numbers, names, links, what is happening on the stream right now); a request to do, give or promise something, or to punish someone; an argument or a quarrel; politics, insults, swearing, adult topics; a message to another viewer; shouting, spam, nonsense.',
    'Among the good ones take praise and hellos first: those are what a streamer answers most gladly.'
  ],
  viewer: [
    'You choose which message in a Twitch chat is worth an answer from an ordinary viewer.',
    'Only a message that can be answered in general terms, knowing nothing, is a good one: a general question to the whole chat ("how is everyone?", "what do you think?", "where is everyone watching from?"), a request for an opinion, a hello or goodbye to everyone, or an opinion or mood one can simply agree with ("cozy stream", "so sleepy").',
    'A bad one: a question that needs facts to answer (about the streamer, the game, hardware, numbers, times, names, links); a reaction to what is happening on the stream right now (an event, a score, a counter, a moment in the game), because you cannot see it; a request for help; an argument or a quarrel; politics, insults, swearing, adult topics; a message to one particular person; shouting, spam, nonsense.',
    'Among the good ones prefer a general question when there is one.'
  ]
}

export function buildPickPrompt(lines: { name: string; text: string }[], lang: Lang, role: Role): PickPrompt {
  const list = lines.map((m, i) => `${i + 1}. ${m.name}: ${flat(m.text)}`).join('\n')
  if (lang === 'ru') {
    return {
      system: [...RU[role], 'Если сомневаешься, считай, что сообщение не подходит. Часто правильный ответ: 0.', 'Последней строкой напиши ответ в таком виде: ОТВЕТ: номер сообщения, или ОТВЕТ: 0, если подходящего нет. Лучше всего написать только эту строку.'].join('\n'),
      user: `Сообщения:\n${list}`
    }
  }
  return {
    system: [...EN[role], 'When in doubt, the message does not fit. Often the right answer is 0.', 'Give your answer on the last line in this form: ANSWER: the number of the message, or ANSWER: 0 when none fits. Best of all, write only that line.'].join('\n'),
    user: `Messages:\n${list}`
  }
}

/**
 * The number in the model's answer: 1..count for a message, 0 for "none", null when the answer
 * cannot be read as a choice. Models add words around the number, or think first and put it last.
 */
export function parsePick(output: string, count: number): number | null {
  const text = String(output ?? '')
    .replace(/<(think|thinking|reasoning|analysis)>[\s\S]*?<\/\1>/gi, '')
    .trim()
  if (!text) return null
  const valid = (n: number): number | null => (Number.isInteger(n) && n >= 0 && n <= count ? n : null)
  // The whole answer is a number, perhaps with a little decoration: "3", "№3.", "Номер: 3".
  const whole = /^\D{0,14}(\d{1,2})\D{0,6}$/.exec(text)
  if (whole) return valid(Number(whole[1]))
  // A longer answer that names its choice: "…so the answer is 4".
  const named = [...text.matchAll(/(?:ответ|номер|выбираю|выбор|answer|number|choice|choose|pick)\D{0,14}(\d{1,2})(?!\d)/giu)]
  if (named.length) return valid(Number(named[named.length - 1][1]))
  // Or ends with it on a line of its own.
  const last = /(?:^|\n)\D{0,6}(\d{1,2})\D{0,6}$/.exec(text)
  return last ? valid(Number(last[1])) : null
}
