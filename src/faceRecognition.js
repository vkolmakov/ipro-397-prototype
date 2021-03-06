import Rx from 'rxjs/Rx'

import { Socket, messageTypes } from './socket'
import { getDataURLFromRGB } from './util'
import { Image, Person, dropAll } from './db'

const socket = new Socket({ address: 'ws://localhost:9000' })

export const identity$ = socket.message$
  .filter(message => message.type === messageTypes.IDENTITIES)
  // stream of identities
  .map(message => {
    const recognizedPersonId =
          message.identities.length > 0
          ? message.identities[0]
          : null

    return recognizedPersonId
  })

export const image$ = socket.message$
  .filter(message => message.type == messageTypes.NEW_IMAGE)
  // stream of processed images
  .map(message => ({
    image: getDataURLFromRGB(message.content),
    hash: message.hash,
    representation: message.representation,
    identity: message.identity,
  }))
  // save incomming images to db
  .subscribe(image => Image.save(image))

export const state$ = socket.open$
  // initial state set-up
  .flatMap(_ => getInitialState())
  .map(([images, persons]) => {
    // send the initial state when socket is opened
    sendInitialState(images, persons)
    // and send the state to the front
    return { images, persons }
  })

export const error$ = socket.error$
  .map(err => 'A problem occurred with face recognition socket.')


export const savePerson = ({ name, id }) => {
  const msg = {
    type: messageTypes.ADD_PERSON,
    val: name,
  }

  return Promise.all([Person.save({ name, id }),
                      socket.send(JSON.stringify(msg))])
}

export const recognize = ({ photo }) => new Promise((resolve, reject) => {
  const msg = {
    type: messageTypes.FRAME,
    dataURL: photo,
    identity: null,
  }

  return socket.send(JSON.stringify(msg))
})

export const train = ({ id, getPhoto, onStart, onProgress, onError, onComplete }) => {
  const NUM_MESSAGES = 10
  const INTERVAL = 1500

  const startMsg = {
    type: messageTypes.TRAINING,
    val: true,
  }

  onStart()
  socket.send(JSON.stringify(startMsg))

  Rx.Observable.interval(INTERVAL)
    .take(NUM_MESSAGES + 1)
    .subscribe({
      next (currentMessage) {
        const msg = {
          type: messageTypes.FRAME,
          dataURL: getPhoto(),
          identity: id,
        }

        // update to n+1 because n is zero-based
        onProgress((currentMessage + 1) / NUM_MESSAGES)

        // the n+1th message is not sent to give some time
        // to process the nth message and turn off the training flag
        if (currentMessage < NUM_MESSAGES)
          socket.send(JSON.stringify(msg))
      },

      error (err) {
        onError(`An error occurred: ${err}`)
      },

      complete () {
        const endMsg = {
          type: messageTypes.TRAINING,
          val: false
        }
        socket.send(JSON.stringify(endMsg))
        onComplete()
      }
    })
}

export const dropState = () => dropAll().then(_ => socket.close())

export const getInitialState = () => Promise.all([Image.getAll(), Person.getAll()])

export const sendInitialState = (images = [], persons = [], training = false) => {
  const msg = {
    type: messageTypes.ALL_STATE,
    images,
    people: persons.map(p => p.id.toString()), // a list of ids, dictated by the API
    training,
  }

  socket.send(JSON.stringify(msg))
}
