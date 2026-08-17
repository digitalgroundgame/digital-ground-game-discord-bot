export class SingleFlight {
  private inProgress = false

  public acquire(): (() => void) | undefined {
    if (this.inProgress) {
      return undefined
    }

    this.inProgress = true
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.inProgress = false
    }
  }
}
